import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string, page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { companyId },
        skip,
        take: limit,
        orderBy: { lastMessageAt: 'desc' },
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              phone: true,
              avatar: true,
            },
          },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              content: true,
              type: true,
              direction: true,
              status: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.conversation.count({
        where: { companyId },
      }),
    ]);

    return {
      data: conversations,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(companyId: string, contactId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: {
        companyId_contactId: {
          companyId,
          contactId,
        },
      },
      include: {
        contact: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 100, // Last 100 messages
        },
      },
    });

    return conversation;
  }

  async getMessages(
    companyId: string,
    contactId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const conversation = await this.prisma.conversation.findUnique({
      where: {
        companyId_contactId: {
          companyId,
          contactId,
        },
      },
    });

    if (!conversation) {
      return {
        data: [],
        meta: {
          total: 0,
          page,
          limit,
          totalPages: 0,
        },
      };
    }

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          companyId,
          contactId,
          conversationId: conversation.id,
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.message.count({
        where: {
          companyId,
          contactId,
          conversationId: conversation.id,
        },
      }),
    ]);

    return {
      data: messages.reverse(), // Reverse to show oldest first
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

