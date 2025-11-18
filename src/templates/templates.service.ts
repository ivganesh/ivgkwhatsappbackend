import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  CreateTemplateDto,
  TemplateComponentDto,
} from './dto/create-template.dto';
import { TemplateStatus, Role, TemplateCategory } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class TemplatesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private getApiClient(accessToken: string): AxiosInstance {
    const baseUrl =
      this.configService.get<string>('whatsapp.apiUrl') ||
      'https://graph.facebook.com/v18.0';
    return axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private async validateAccess(
    companyId: string,
    userId: string,
    roles?: Role[],
  ) {
    const companyUser = await this.prisma.companyUser.findFirst({
      where: {
        companyId,
        userId,
        isActive: true,
        ...(roles && roles.length > 0
          ? {
              role: {
                in: roles,
              },
            }
          : {}),
      },
    });

    if (!companyUser) {
      throw new ForbiddenException('You do not have access to this company');
    }

    return companyUser;
  }

  async create(
    companyId: string,
    userId: string,
    createTemplateDto: CreateTemplateDto,
  ) {
    await this.validateAccess(companyId, userId);

    const sanitizedName = this.sanitizeTemplateName(createTemplateDto.name);
    if (!sanitizedName) {
      throw new BadRequestException(
        'Template name must contain only lowercase letters, numbers, or underscores',
      );
    }
    createTemplateDto.name = sanitizedName;

    // Check if template name already exists for this company
    const existing = await this.prisma.template.findUnique({
      where: {
        companyId_name: {
          companyId,
          name: createTemplateDto.name,
        },
      },
    });

    if (existing) {
      throw new BadRequestException('Template with this name already exists');
    }

    const normalizedComponents = this.normalizeAndValidateComponents(
      createTemplateDto.components,
    );

    const template = await this.prisma.template.create({
      data: {
        companyId,
        name: createTemplateDto.name,
        category: createTemplateDto.category,
        language: this.normalizeLanguageCode(createTemplateDto.language),
        components: normalizedComponents as any,
        variables: createTemplateDto.variables || {},
        status: TemplateStatus.DRAFT,
        rejectionReason: null,
      },
    });

    return template;
  }

  async findAll(
    companyId: string,
    userId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    await this.validateAccess(companyId, userId);

    const skip = (page - 1) * limit;

    const [templates, total] = await Promise.all([
      this.prisma.template.findMany({
        where: { companyId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.template.count({
        where: { companyId },
      }),
    ]);

    return {
      data: templates,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(companyId: string, userId: string, id: string) {
    await this.validateAccess(companyId, userId);

    const template = await this.prisma.template.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        _count: {
          select: {
            campaigns: true,
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    return template;
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    updateData: Partial<CreateTemplateDto>,
  ) {
    // Verify access and permissions
    await this.validateAccess(companyId, userId, [
      Role.OWNER,
      Role.ADMIN,
      Role.MANAGER,
    ]);

    const template = await this.prisma.template.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Cannot update if template is approved and has WhatsApp template ID
    if (
      template.status === TemplateStatus.APPROVED &&
      template.whatsappTemplateId
    ) {
      throw new BadRequestException(
        'Cannot update approved template. Create a new version instead.',
      );
    }

    if (updateData.name) {
      const sanitized = this.sanitizeTemplateName(updateData.name);
      if (!sanitized) {
        throw new BadRequestException(
          'Template name must contain only lowercase letters, numbers, or underscores',
        );
      }

      const nameConflict = await this.prisma.template.findUnique({
        where: {
          companyId_name: {
            companyId,
            name: sanitized,
          },
        },
      });

      if (nameConflict && nameConflict.id !== id) {
        throw new BadRequestException('Another template already uses this name');
      }
      updateData.name = sanitized;
    }

    if (updateData.language) {
      updateData.language = this.normalizeLanguageCode(updateData.language);
    }

    if (updateData.components) {
      updateData.components = this.normalizeAndValidateComponents(
        updateData.components,
      );
    }

    return this.prisma.template.update({
      where: { id },
      data: {
        ...updateData,
        components: updateData.components
          ? (updateData.components as any)
          : undefined,
      },
    });
  }

  async delete(companyId: string, userId: string, id: string) {
    // Verify access and permissions
    await this.validateAccess(companyId, userId, [
      Role.OWNER,
      Role.ADMIN,
      Role.MANAGER,
    ]);

    const template = await this.prisma.template.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Check if template is used in any campaigns
    const campaignCount = await this.prisma.campaign.count({
      where: {
        templateId: id,
      },
    });

    if (campaignCount > 0) {
      throw new BadRequestException(
        'Cannot delete template that is used in campaigns',
      );
    }

    await this.prisma.template.delete({
      where: { id },
    });

    return { message: 'Template deleted successfully' };
  }

  async submitToMeta(companyId: string, userId: string, id: string) {
    await this.validateAccess(companyId, userId, [
      Role.OWNER,
      Role.ADMIN,
      Role.MANAGER,
    ]);

    const template = await this.prisma.template.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (template.whatsappTemplateId) {
      throw new BadRequestException('Template already submitted to Meta');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (
      !company ||
      !company.whatsappConnected ||
      !company.whatsappAccessToken ||
      !company.whatsappBusinessId
    ) {
      throw new BadRequestException('WhatsApp not connected for this company');
    }

    const normalizedComponents = this.normalizeAndValidateComponents(
        template.components as any,
      );
    const components = this.buildMetaComponents(normalizedComponents);

    try {
      const apiClient = this.getApiClient(company.whatsappAccessToken);
      const response = await apiClient.post(
        `/${company.whatsappBusinessId}/message_templates`,
        {
          name: this.sanitizeTemplateName(template.name),
          category: template.category,
          allow_category_change: true,
          language: this.normalizeLanguageCode(template.language),
          components,
        },
      );

      const metaTemplateId = response.data?.id;

      const updated = await this.prisma.template.update({
        where: { id },
        data: {
          status: TemplateStatus.PENDING,
          whatsappTemplateId: metaTemplateId,
          rejectionReason: null,
        },
      });

      return {
        message: 'Template submitted to Meta for review',
        template: updated,
      };
    } catch (error: any) {
      const metaMessage =
        error.response?.data?.error?.message ||
        'Failed to submit template to Meta';
      throw new BadRequestException(metaMessage);
    }
  }

  async syncFromMeta(companyId: string, userId: string) {
    await this.validateAccess(companyId, userId, [
      Role.OWNER,
      Role.ADMIN,
      Role.MANAGER,
    ]);

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (
      !company ||
      !company.whatsappConnected ||
      !company.whatsappAccessToken ||
      !company.whatsappBusinessId
    ) {
      throw new BadRequestException('WhatsApp not connected for this company');
    }

    try {
      const apiClient = this.getApiClient(company.whatsappAccessToken);
      const response = await apiClient.get(
        `/${company.whatsappBusinessId}/message_templates`,
        {
          params: { limit: 100 },
        },
      );

      const templates = response.data?.data || [];
      let created = 0;
      let updated = 0;

      for (const remoteTemplate of templates) {
        const metaId = remoteTemplate.id;
        const status = this.mapMetaStatus(remoteTemplate.status);
        const category = this.mapMetaCategory(remoteTemplate.category);
        const components = remoteTemplate.components || [];

        let existing: Awaited<
          ReturnType<typeof this.prisma.template.findUnique>
        > | null = null;
        if (metaId) {
          existing = await this.prisma.template.findUnique({
            where: { whatsappTemplateId: metaId },
          });
        }

        if (!existing) {
          existing = await this.prisma.template.findUnique({
            where: {
              companyId_name: {
                companyId,
                name: remoteTemplate.name,
              },
            },
          });
        }

        const rejectionReason = this.extractRejectionReason(remoteTemplate);

        const payload = {
          name: remoteTemplate.name,
          language: this.normalizeLanguageCode(
            remoteTemplate.language || 'en_US',
          ),
          category,
          status,
          components,
          whatsappTemplateId: metaId,
          rejectionReason: status === TemplateStatus.REJECTED ? rejectionReason : null,
        };

        if (existing) {
          await this.prisma.template.update({
            where: { id: existing.id },
            data: payload,
          });
          updated += 1;
        } else {
          await this.prisma.template.create({
            data: {
              companyId,
              ...payload,
            },
          });
          created += 1;
        }
      }

      return {
        message: 'Templates synced successfully',
        summary: {
          synced: templates.length,
          created,
          updated,
        },
      };
    } catch (error: any) {
      const metaMessage =
        error.response?.data?.error?.message ||
        'Failed to sync templates from Meta';
      throw new BadRequestException(metaMessage);
    }
  }

  private sanitizeTemplateName(name: string) {
    return name?.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  private normalizeLanguageCode(code: string) {
    if (!code) {
      return 'en_US';
    }
    const trimmed = code.trim();
    if (trimmed.includes('_')) {
      const [lang, region] = trimmed.split('_');
      return `${lang.toLowerCase()}_${region.toUpperCase()}`;
    }
    return trimmed.toLowerCase();
  }

  private normalizeAndValidateComponents(
    rawComponents: any,
  ): TemplateComponentDto[] {
    if (!Array.isArray(rawComponents) || rawComponents.length === 0) {
      throw new BadRequestException('At least one template component is required');
    }

    const components: TemplateComponentDto[] = rawComponents.map(
      (component: any) => ({
        ...component,
        type: (component?.type || '').toString().toUpperCase(),
        format: component?.format
          ? component.format.toString().toUpperCase()
          : component?.type?.toUpperCase() === 'HEADER'
            ? 'TEXT'
            : undefined,
        text:
          typeof component?.text === 'string'
            ? component.text
            : undefined,
        buttons: component?.buttons,
        example: component?.example,
      }),
    );

    const body = components.find(
      (component) => component.type === 'BODY',
    );
    if (!body || !body.text?.trim()) {
      throw new BadRequestException(
        'Template body is required and cannot be empty',
      );
    }

    const bodyText = body.text.trim();
    if (bodyText.length > 1024) {
      throw new BadRequestException(
        'Body text cannot exceed 1024 characters',
      );
    }
    this.validatePlaceholderSequence(bodyText);

    const header = components.find(
      (component) => component.type === 'HEADER',
    );
    if (header) {
      const headerFormat = header.format || 'TEXT';
      if (headerFormat === 'TEXT') {
        if (!header.text?.trim()) {
          throw new BadRequestException(
            'Header text is required when header format is TEXT',
          );
        }
        if (header.text.trim().length > 60) {
          throw new BadRequestException(
            'Header text cannot exceed 60 characters',
          );
        }
      } else if (header.text) {
        throw new BadRequestException(
          `Header text is not allowed when using ${headerFormat} format`,
        );
      }
    }

    const footer = components.find(
      (component) => component.type === 'FOOTER',
    );
    if (footer?.text && footer.text.length > 60) {
      throw new BadRequestException(
        'Footer text cannot exceed 60 characters',
      );
    }

    return components;
  }

  private validatePlaceholderSequence(text: string) {
    const regex = /{{(\d+)}}/g;
    const found = new Set<number>();
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const index = parseInt(match[1], 10);
      if (isNaN(index) || index < 1) {
        throw new BadRequestException(
          'Placeholder indexes must be positive numbers (e.g., {{1}})',
        );
      }
      if (index > 10) {
        throw new BadRequestException(
          'A maximum of 10 placeholders ({{1}} to {{10}}) are allowed in the body',
        );
      }
      found.add(index);
    }

    if (found.size > 0) {
      const max = Math.max(...Array.from(found.values()));
      for (let i = 1; i <= max; i += 1) {
        if (!found.has(i)) {
          throw new BadRequestException(
            'Placeholders must be sequential without gaps (e.g., {{1}}, {{2}}, ...)',
          );
        }
      }
    }
  }

  private buildMetaComponents(components: TemplateComponentDto[]): any[] {
    return components.map((component) => {
      const payload: any = {
        type: component.type,
      };

      if (component.format) {
        payload.format = component.format;
      }
      if (component.text) {
        payload.text = component.text;
      }
      if (component.example) {
        payload.example = component.example;
      }
      if (component.buttons) {
        payload.buttons = component.buttons;
      }
      if (component.variables) {
        payload.variables = component.variables;
      }

      return payload;
    });
  }

  private extractRejectionReason(remoteTemplate: any): string | null {
    const direct =
      remoteTemplate?.rejection_reason ||
      remoteTemplate?.reject_reason ||
      remoteTemplate?.reject_reasons;
    if (typeof direct === 'string' && direct.trim()) {
      return direct.trim();
    }
    if (Array.isArray(remoteTemplate?.status_reasons)) {
      return remoteTemplate.status_reasons
        .map((reason: any) => reason?.description || reason)
        .filter(Boolean)
        .join(', ');
    }
    if (remoteTemplate?.review_status?.rejected_reason) {
      return remoteTemplate.review_status.rejected_reason;
    }
    return null;
  }

  private mapMetaStatus(status: string): TemplateStatus {
    switch (status?.toUpperCase()) {
      case 'APPROVED':
        return TemplateStatus.APPROVED;
      case 'REJECTED':
        return TemplateStatus.REJECTED;
      case 'PENDING':
      case 'IN_APPEAL':
      default:
        return TemplateStatus.PENDING;
    }
  }

  private mapMetaCategory(category: string): TemplateCategory {
    switch (category?.toUpperCase()) {
      case 'MARKETING':
        return TemplateCategory.MARKETING;
      case 'AUTHENTICATION':
        return TemplateCategory.AUTHENTICATION;
      case 'UTILITY':
      default:
        return TemplateCategory.UTILITY;
    }
  }
}
