import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { Role } from '@prisma/client';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, createCompanyDto: CreateCompanyDto) {
    const { name, slug, timezone, locale } = createCompanyDto;

    // Check if slug is already taken
    const existingCompany = await this.prisma.company.findUnique({
      where: { slug },
    });

    if (existingCompany) {
      throw new ConflictException('Company slug already exists');
    }

    // Create company with owner
    const company = await this.prisma.company.create({
      data: {
        name,
        slug,
        timezone: timezone || 'UTC',
        locale: locale || 'en',
        ownerId: userId,
        users: {
          create: {
            userId,
            role: Role.OWNER,
          },
        },
        credits: {
          create: {
            balance: 0,
          },
        },
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        users: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    return company;
  }

  async findAll(userId: string) {
    const companies = await this.prisma.company.findMany({
      where: {
        users: {
          some: {
            userId,
            isActive: true,
          },
        },
      },
      include: {
        users: {
          where: {
            userId,
          },
          select: {
            role: true,
          },
        },
        _count: {
          select: {
            contacts: true,
            messages: true,
            campaigns: true,
          },
        },
      },
    });

    return companies.map((company) => ({
      ...company,
      role: company.users[0]?.role,
    }));
  }

  async findOne(id: string, userId: string) {
    const company = await this.prisma.company.findFirst({
      where: {
        id,
        users: {
          some: {
            userId,
            isActive: true,
          },
        },
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        users: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        credits: true,
        _count: {
          select: {
            contacts: true,
            messages: true,
            campaigns: true,
            templates: true,
            chatbots: true,
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return company;
  }

  async update(id: string, userId: string, updateData: Partial<CreateCompanyDto>) {
    // Check if user has permission (OWNER or ADMIN)
    const companyUser = await this.prisma.companyUser.findFirst({
      where: {
        companyId: id,
        userId,
        isActive: true,
        role: {
          in: [Role.OWNER, Role.ADMIN],
        },
      },
    });

    if (!companyUser) {
      throw new ForbiddenException('You do not have permission to update this company');
    }

    const company = await this.prisma.company.update({
      where: { id },
      data: updateData,
    });

    return company;
  }

  async addUser(companyId: string, userId: string, newUserId: string, role: Role) {
    // Check if requester has permission
    const requester = await this.prisma.companyUser.findFirst({
      where: {
        companyId,
        userId,
        isActive: true,
        role: {
          in: [Role.OWNER, Role.ADMIN],
        },
      },
    });

    if (!requester) {
      throw new ForbiddenException('You do not have permission to add users');
    }

    // Check if user already exists in company
    const existing = await this.prisma.companyUser.findUnique({
      where: {
        companyId_userId: {
          companyId,
          userId: newUserId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('User already exists in this company');
    }

    const companyUser = await this.prisma.companyUser.create({
      data: {
        companyId,
        userId: newUserId,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return companyUser;
  }

  async removeUser(companyId: string, userId: string, targetUserId: string) {
    // Check if requester has permission
    const requester = await this.prisma.companyUser.findFirst({
      where: {
        companyId,
        userId,
        isActive: true,
        role: {
          in: [Role.OWNER, Role.ADMIN],
        },
      },
    });

    if (!requester) {
      throw new ForbiddenException('You do not have permission to remove users');
    }

    // Cannot remove owner
    const target = await this.prisma.companyUser.findFirst({
      where: {
        companyId,
        userId: targetUserId,
      },
    });

    if (target?.role === Role.OWNER) {
      throw new ForbiddenException('Cannot remove company owner');
    }

    await this.prisma.companyUser.delete({
      where: {
        companyId_userId: {
          companyId,
          userId: targetUserId,
        },
      },
    });

    return { message: 'User removed from company' };
  }
}

