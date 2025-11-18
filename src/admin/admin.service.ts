import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getAllUsers(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          emailVerifiedAt: true,
          isActive: true,
          isSuperAdmin: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              companies: true,
            },
          },
        },
      }),
      this.prisma.user.count(),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        companies: {
          include: {
            company: {
              select: {
                id: true,
                name: true,
                slug: true,
                whatsappConnected: true,
              },
            },
          },
        },
        subscriptions: {
          include: {
            plan: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async createUser(createUserDto: CreateUserDto) {
    const { email, password, name, isSuperAdmin, timezone, locale } = createUserDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        isSuperAdmin: isSuperAdmin || false,
        timezone: timezone || 'UTC',
        locale: locale || 'en',
        emailVerifiedAt: new Date(), // Auto-verify admin-created users
      },
      select: {
        id: true,
        email: true,
        name: true,
        isSuperAdmin: true,
        isActive: true,
        createdAt: true,
      },
    });

    return user;
  }

  async updateUser(id: string, updateData: Partial<CreateUserDto>) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatePayload: any = {};

    if (updateData.name) updatePayload.name = updateData.name;
    if (updateData.email) updatePayload.email = updateData.email;
    if (updateData.timezone) updatePayload.timezone = updateData.timezone;
    if (updateData.locale) updatePayload.locale = updateData.locale;
    if (updateData.isSuperAdmin !== undefined)
      updatePayload.isSuperAdmin = updateData.isSuperAdmin;

    if (updateData.password) {
      updatePayload.password = await bcrypt.hash(updateData.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data: updatePayload,
      select: {
        id: true,
        email: true,
        name: true,
        isSuperAdmin: true,
        isActive: true,
        updatedAt: true,
      },
    });
  }

  async deleteUser(id: string, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException('Cannot delete your own account');
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.delete({
      where: { id },
    });

    return { message: 'User deleted successfully' };
  }

  async toggleUserStatus(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        isActive: !user.isActive,
      },
      select: {
        id: true,
        email: true,
        isActive: true,
      },
    });
  }

  async getAllCompanies(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;

    const [companies, total] = await Promise.all([
      this.prisma.company.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              users: true,
              contacts: true,
              messages: true,
              campaigns: true,
            },
          },
        },
      }),
      this.prisma.company.count(),
    ]);

    return {
      data: companies,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCompanyById(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        owner: true,
        users: {
          include: {
            user: true,
          },
        },
        _count: {
          select: {
            contacts: true,
            messages: true,
            campaigns: true,
            templates: true,
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return company;
  }

  async toggleCompanyStatus(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return this.prisma.company.update({
      where: { id },
      data: {
        isActive: !company.isActive,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    });
  }

  async getSystemStats() {
    const [
      totalUsers,
      activeUsers,
      totalCompanies,
      activeCompanies,
      totalMessages,
      totalContacts,
      totalCampaigns,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.company.count(),
      this.prisma.company.count({ where: { isActive: true } }),
      this.prisma.message.count(),
      this.prisma.contact.count(),
      this.prisma.campaign.count(),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
      },
      companies: {
        total: totalCompanies,
        active: activeCompanies,
        inactive: totalCompanies - activeCompanies,
      },
      messages: {
        total: totalMessages,
      },
      contacts: {
        total: totalContacts,
      },
      campaigns: {
        total: totalCampaigns,
      },
    };
  }
}




