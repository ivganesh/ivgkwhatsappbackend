import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
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

    const template = await this.prisma.template.create({
      data: {
        companyId,
        name: createTemplateDto.name,
        category: createTemplateDto.category,
        language: createTemplateDto.language,
        components: createTemplateDto.components as any,
        variables: createTemplateDto.variables || {},
        status: TemplateStatus.DRAFT,
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

    const components = this.buildMetaComponents(template.components as any);
    const hasBody = components.some((component) => component.type === 'BODY');

    if (!hasBody) {
      throw new BadRequestException('Template must include a BODY component');
    }

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

        const payload = {
          name: remoteTemplate.name,
          language: remoteTemplate.language || 'en_US',
          category,
          status,
          components,
          whatsappTemplateId: metaId,
          rejectionReason: remoteTemplate.reject_reason || null,
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
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
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

  private buildMetaComponents(components: any[]): any[] {
    if (!Array.isArray(components)) {
      return [];
    }

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
