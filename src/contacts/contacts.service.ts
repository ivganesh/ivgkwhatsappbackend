import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, createContactDto: CreateContactDto) {
    const { phone, name, email, countryCode, tags } = createContactDto;

    const contact = await this.prisma.contact.create({
      data: {
        companyId,
        phone,
        name,
        email,
        countryCode,
        tags: tags || [],
      },
    });

    return contact;
  }

  async findAll(companyId: string, page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;

    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where: { companyId },
        skip,
        take: limit,
        orderBy: { lastMessageAt: 'desc' },
      }),
      this.prisma.contact.count({
        where: { companyId },
      }),
    ]);

    return {
      data: contacts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(companyId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: {
        id,
        companyId,
      },
      include: {
        groups: {
          include: {
            group: true,
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    return contact;
  }

  async update(companyId: string, id: string, updateData: Partial<CreateContactDto>) {
    const contact = await this.prisma.contact.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    return this.prisma.contact.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(companyId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: {
        id,
        companyId,
      },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    await this.prisma.contact.delete({
      where: { id },
    });

    return { message: 'Contact deleted' };
  }
}

