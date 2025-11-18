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

  async importContacts(companyId: string, contacts: CreateContactDto[]) {
    if (!contacts || contacts.length === 0) {
      return {
        success: false,
        message: 'No contacts provided for import',
        summary: {
          processed: 0,
          created: 0,
          updated: 0,
          skipped: 0,
        },
      };
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const contact of contacts) {
      if (!contact.phone) {
        skipped += 1;
        continue;
      }

      const tags = contact.tags?.filter(Boolean) || [];

      try {
        const result = await this.prisma.contact.upsert({
          where: {
            companyId_phone: {
              companyId,
              phone: contact.phone,
            },
          },
          update: {
            name: contact.name || undefined,
            email: contact.email || undefined,
            countryCode: contact.countryCode || undefined,
            tags,
          },
          create: {
            companyId,
            phone: contact.phone,
            name: contact.name,
            email: contact.email,
            countryCode: contact.countryCode,
            tags,
          },
        });

        if (result.createdAt.getTime() === result.updatedAt.getTime()) {
          created += 1;
        } else {
          updated += 1;
        }
      } catch (error) {
        skipped += 1;
      }
    }

    return {
      success: true,
      message: 'Contacts imported successfully',
      summary: {
        processed: contacts.length,
        created,
        updated,
        skipped,
      },
    };
  }
}

