import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('companies')
@Controller('companies')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() createCompanyDto: CreateCompanyDto) {
    return this.companiesService.create(user.id, createCompanyDto);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.companiesService.findAll(user.id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.companiesService.findOne(id, user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() updateData: Partial<CreateCompanyDto>,
  ) {
    return this.companiesService.update(id, user.id, updateData);
  }

  @Post(':id/users')
  addUser(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('userId') userId: string,
    @Body('role') role: Role,
  ) {
    return this.companiesService.addUser(id, user.id, userId, role);
  }

  @Delete(':id/users/:userId')
  removeUser(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.companiesService.removeUser(id, user.id, userId);
  }
}

