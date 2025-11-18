import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { TemplateStatus, Role } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class TemplatesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async create(companyId: string, userId: string, createTemplateDto: CreateTemplateDto) {
    // Verify access
    const companyUser = await this.prisma.companyUser.findFirst({
      where: {
        companyId,
        userId,
        isActive: true,
      },
    });

    if (!companyUser) {
      throw new ForbiddenException('You do not have access to this company');
    }

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

  async findAll(companyId: string, userId: string, page: number = 1, limit: number = 50) {
    // Verify access
    const companyUser = await this.prisma.companyUser.findFirst({
      where: {
        companyId,
        userId,
        isActive: true,
      },
    });

    if (!companyUser) {
      throw new ForbiddenException('You do not have access to this company');
    }

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
    // Verify access
    const companyUser = await this.prisma.companyUser.findFirst({
      where: {
        companyId,
        userId,
        isActive: true,
      },
    });

    if (!companyUser) {
      throw new ForbiddenException('You do not have access to this company');
    }

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
    const companyUser = await this.prisma.companyUser.findFirst({
      where: {
        companyId,
        userId,
        isActive: true,
        role: {
          in: [Role.OWNER, Role.ADMIN, Role.MANAGER],
        },
      },
    });

    if (!companyUser) {
      throw new ForbiddenException('You do not have permission to update templates');
    }

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
    if (template.status === TemplateStatus.APPROVED && template.whatsappTemplateId) {
      throw new BadRequestException('Cannot update approved template. Create a new version instead.');
    }

    return this.prisma.template.update({
      where: { id },
      data: {
        ...updateData,
        components: updateData.components ? (updateData.components as any) : undefined,
      },
    });
  }

  async delete(companyId: string, userId: string, id: string) {
    // Verify access and permissions
    const companyUser = await this.prisma.companyUser.findFirst({
      where: {
        companyId,
        userId,
        isActive: true,
        role: {
          in: [Role.OWNER, Role.ADMIN, Role.MANAGER],
        },
      },
    });

    if (!companyUser) {
      throw new ForbiddenException('You do not have permission to delete templates');
    }

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
      throw new BadRequestException('Cannot delete template that is used in campaigns');
    }

    await this.prisma.template.delete({
      where: { id },
    });

    return { message: 'Template deleted successfully' };
  }

  async submitToMeta(companyId: string, userId: string, id: string) {
    // Verify access and permissions
    const companyUser = await this.prisma.companyUser.findFirst({
      where: {
        companyId,
        userId,
        isActive: true,
        role: {
          in: [Role.OWNER, Role.ADMIN, Role.MANAGER],
        },
      },
    });

    if (!companyUser) {
      throw new ForbiddenException('You do not have permission to submit templates');
    }

    const template = await this.prisma.template.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company || !company.whatsappConnected || !company.whatsappAccessToken) {
      throw new BadRequestException('WhatsApp not connected for this company');
    }

    // TODO: Implement actual Meta API submission
    // This would involve:
    // 1. Formatting the template according to Meta's requirements
    // 2. Calling Meta's template creation API
    // 3. Storing the returned template ID
    // 4. Updating template status to PENDING

    // For now, just update status
    const updated = await this.prisma.template.update({
      where: { id },
      data: {
        status: TemplateStatus.PENDING,
      },
    });

    return {
      message: 'Template submitted to Meta for review',
      template: updated,
    };
  }
}




