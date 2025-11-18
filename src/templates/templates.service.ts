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
        throw new BadRequestException(
          'Another template already uses this name',
        );
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

    if (
      template.whatsappTemplateId &&
      template.status !== TemplateStatus.REJECTED
    ) {
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

    if (
      template.status === TemplateStatus.REJECTED &&
      template.whatsappTemplateId
    ) {
      try {
        await this.getApiClient(company.whatsappAccessToken).delete(
          `/${template.whatsappTemplateId}`,
        );
      } catch (err) {
        // log but continue
      }
      await this.prisma.template.update({
        where: { id },
        data: {
          whatsappTemplateId: null,
          status: TemplateStatus.DRAFT,
        },
      });
      template.whatsappTemplateId = null;
    }

    const normalizedComponents = this.normalizeAndValidateComponents(
      template.components as any,
    );
    const components = this.buildMetaComponents(normalizedComponents);

    try {
      const apiClient = this.getApiClient(company.whatsappAccessToken);
      const payload = {
        name: this.sanitizeTemplateName(template.name),
        category: template.category,
        allow_category_change: true,
        language: this.normalizeLanguageCode(template.language),
        components,
      };

      // Log the payload for debugging
      console.log(
        'Submitting template to Meta:',
        JSON.stringify(payload, null, 2),
      );

      const response = await apiClient.post(
        `/${company.whatsappBusinessId}/message_templates`,
        payload,
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
      console.error('Meta API error:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });

      const metaError = error.response?.data?.error;
      const metaMessage =
        metaError?.message ||
        metaError?.error_user_msg ||
        error.response?.data?.error_description ||
        'Failed to submit template to Meta';

      // Include more details in the error message
      const errorDetails = metaError?.error_subcode
        ? ` (Error code: ${metaError.error_subcode})`
        : '';
      const fullMessage = `${metaMessage}${errorDetails}`;

      throw new BadRequestException(fullMessage);
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
          rejectionReason:
            status === TemplateStatus.REJECTED ? rejectionReason : null,
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
      throw new BadRequestException(
        'At least one template component is required',
      );
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
        text: typeof component?.text === 'string' ? component.text : undefined,
        buttons: component?.buttons,
        example: component?.example,
      }),
    );

    const body = components.find((component) => component.type === 'BODY');
    if (!body || !body.text?.trim()) {
      throw new BadRequestException(
        'Template body is required and cannot be empty',
      );
    }

    const bodyText = body.text.trim();
    if (bodyText.length > 1024) {
      throw new BadRequestException('Body text cannot exceed 1024 characters');
    }
    const bodyPlaceholderIndexes = this.getPlaceholderIndexes(bodyText);
    this.validatePlaceholderSequence(bodyText);

    if (bodyPlaceholderIndexes.length > 0) {
      // Extract body example - Meta stores it as nested array: [[values]]
      let exampleSource: any[] = [];
      const bodyExample = (body.example as any)?.body_text;

      if (bodyExample) {
        if (Array.isArray(bodyExample)) {
          // If it's already nested (array of arrays), take the first array
          if (Array.isArray(bodyExample[0])) {
            exampleSource = bodyExample[0];
          } else {
            // If it's a flat array, use it directly
            exampleSource = bodyExample;
          }
        }
      }

      const normalizedSamples = exampleSource
        .map((value: any) => value?.toString().trim())
        .filter((sample) => sample);

      if (normalizedSamples.length < bodyPlaceholderIndexes.length) {
        throw new BadRequestException(
          'Provide sample values for every body placeholder ({{1}}, {{2}}, ...).',
        );
      }
      if (normalizedSamples.some((sample) => !sample)) {
        throw new BadRequestException(
          'Body placeholder samples cannot be empty.',
        );
      }
      // Meta expects body_text as nested array: [[values]]
      body.example = { body_text: [normalizedSamples] };
    } else if (body.example) {
      // Remove body_text if no placeholders
      delete (body.example as any).body_text;
    }

    const header = components.find((component) => component.type === 'HEADER');
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

      if (header.text) {
        const headerPlaceholders = this.getPlaceholderIndexes(header.text);
        if (headerPlaceholders.length > 0) {
          const headerExample =
            (header.example as any)?.header_text ||
            (header.example as any)?.header_examples;
          const normalizedHeaderSamples = Array.isArray(headerExample)
            ? headerExample.map((sample: any) => sample?.toString().trim())
            : [];
          if (
            normalizedHeaderSamples.length < headerPlaceholders.length ||
            normalizedHeaderSamples.some((sample) => !sample)
          ) {
            throw new BadRequestException(
              'Provide sample text for each header placeholder.',
            );
          }
          header.example = {
            header_text: normalizedHeaderSamples,
          };
        } else if (header?.example) {
          delete (header.example as any).header_text;
        }
      }
    }

    const footer = components.find((component) => component.type === 'FOOTER');
    if (footer?.text && footer.text.length > 60) {
      throw new BadRequestException('Footer text cannot exceed 60 characters');
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

      // Only include example if it exists and has valid data
      if (component.example) {
        const example: any = {};
        let hasExample = false;

        // Handle body example
        if ((component.example as any).body_text) {
          const bodyText = (component.example as any).body_text;
          // Meta expects body_text to be an array of arrays
          if (Array.isArray(bodyText) && bodyText.length > 0) {
            // If it's already nested, use it; otherwise wrap it
            const normalized = Array.isArray(bodyText[0])
              ? bodyText
              : [bodyText];
            example.body_text = normalized;
            hasExample = true;
          }
        }

        // Handle header example
        if ((component.example as any).header_text) {
          const headerText = (component.example as any).header_text;
          // Meta expects header_text to be an array (not nested)
          if (Array.isArray(headerText) && headerText.length > 0) {
            example.header_text = headerText;
            hasExample = true;
          }
        }

        // Handle header_handle (for media headers)
        if ((component.example as any).header_handle) {
          example.header_handle = (component.example as any).header_handle;
          hasExample = true;
        }

        if (hasExample) {
          payload.example = example;
        }
      }

      if (
        component.buttons &&
        Array.isArray(component.buttons) &&
        component.buttons.length > 0
      ) {
        payload.buttons = component.buttons;
      }
      if (component.variables) {
        payload.variables = component.variables;
      }

      return payload;
    });
  }

  private getPlaceholderIndexes(text: string): number[] {
    const regex = /{{(\d+)}}/g;
    const indexes = new Set<number>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = parseInt(match[1], 10);
      if (!Number.isNaN(value) && value > 0) {
        indexes.add(value);
      }
    }
    return Array.from(indexes).sort((a, b) => a - b);
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
