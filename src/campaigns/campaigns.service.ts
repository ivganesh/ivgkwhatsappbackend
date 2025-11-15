import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { CampaignStatus, Role } from '@prisma/client';

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, userId: string, createCampaignDto: CreateCampaignDto) {
    const { name, description, templateId, groupId, scheduledAt, variables, messagesPerSecond } =
      createCampaignDto;

    // Verify user has access to company
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

    // If template is provided, verify it exists and belongs to company
    if (templateId) {
      const template = await this.prisma.template.findFirst({
        where: {
          id: templateId,
          companyId,
        },
      });

      if (!template) {
        throw new NotFoundException('Template not found');
      }

      if (template.status !== 'APPROVED') {
        throw new BadRequestException('Template must be approved to use in campaigns');
      }
    }

    // If group is provided, verify it exists
    if (groupId) {
      const group = await this.prisma.group.findFirst({
        where: {
          id: groupId,
          companyId,
        },
      });

      if (!group) {
        throw new NotFoundException('Group not found');
      }
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        companyId,
        name,
        description,
        templateId,
        groupId,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        variables: variables || {},
        messagesPerSecond: messagesPerSecond || 10,
        status: scheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.DRAFT,
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return campaign;
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

    const [campaigns, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { companyId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          template: {
            select: {
              id: true,
              name: true,
            },
          },
          group: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              messages: true,
            },
          },
        },
      }),
      this.prisma.campaign.count({
        where: { companyId },
      }),
    ]);

    return {
      data: campaigns,
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

    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        template: true,
        group: true,
        contacts: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        messages: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            contact: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
          },
        },
        _count: {
          select: {
            messages: true,
            contacts: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    return campaign;
  }

  async update(
    companyId: string,
    userId: string,
    id: string,
    updateData: Partial<CreateCampaignDto>,
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
      throw new ForbiddenException('You do not have permission to update campaigns');
    }

    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // Cannot update if campaign is in progress or completed
    if (campaign.status === CampaignStatus.IN_PROGRESS || campaign.status === CampaignStatus.COMPLETED) {
      throw new BadRequestException('Cannot update campaign that is in progress or completed');
    }

    return this.prisma.campaign.update({
      where: { id },
      data: {
        ...updateData,
        scheduledAt: updateData.scheduledAt ? new Date(updateData.scheduledAt) : undefined,
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
      throw new ForbiddenException('You do not have permission to delete campaigns');
    }

    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // Cannot delete if campaign is in progress
    if (campaign.status === CampaignStatus.IN_PROGRESS) {
      throw new BadRequestException('Cannot delete campaign that is in progress');
    }

    await this.prisma.campaign.delete({
      where: { id },
    });

    return { message: 'Campaign deleted successfully' };
  }

  async start(companyId: string, userId: string, id: string) {
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
      throw new ForbiddenException('You do not have permission to start campaigns');
    }

    const campaign = await this.prisma.campaign.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        template: true,
        group: {
          include: {
            contacts: true,
          },
        },
        contacts: true,
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status !== CampaignStatus.DRAFT && campaign.status !== CampaignStatus.SCHEDULED) {
      throw new BadRequestException('Campaign can only be started from draft or scheduled status');
    }

    if (!campaign.templateId) {
      throw new BadRequestException('Campaign must have a template');
    }

    // Update campaign status
    await this.prisma.campaign.update({
      where: { id },
      data: {
        status: CampaignStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
    });

    // TODO: Implement actual message sending logic with queue
    // This would involve:
    // 1. Getting all contacts (from group or campaign contacts)
    // 2. Creating messages for each contact
    // 3. Adding messages to a queue for sending
    // 4. Processing queue with rate limiting

    return { message: 'Campaign started', campaignId: id };
  }
}

