import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string, contactId?: string, page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;

    const where: any = { companyId };
    if (contactId) {
      where.contactId = contactId;
    }

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        skip,
        take: limit,
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
      }),
      this.prisma.message.count({ where }),
    ]);

    return {
      data: messages,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(companyId: string, id: string) {
    return this.prisma.message.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        contact: true,
        conversation: true,
        campaign: true,
      },
    });
  }
}

