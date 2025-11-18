import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('templates')
@Controller('templates')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new message template' })
  create(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Body() createTemplateDto: CreateTemplateDto,
  ) {
    return this.templatesService.create(companyId, user.id, createTemplateDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all templates for a company' })
  findAll(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.templatesService.findAll(
      companyId,
      user.id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get template details' })
  findOne(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.templatesService.findOne(companyId, user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update template' })
  update(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Param('id') id: string,
    @Body() updateData: Partial<CreateTemplateDto>,
  ) {
    return this.templatesService.update(companyId, user.id, id, updateData);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete template' })
  delete(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.templatesService.delete(companyId, user.id, id);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Sync templates from Meta Business Account' })
  syncFromMeta(
    @CurrentUser() user: any,
    @Body('companyId') companyId: string,
  ) {
    return this.templatesService.syncFromMeta(companyId, user.id);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit template to Meta for approval' })
  submitToMeta(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.templatesService.submitToMeta(companyId, user.id, id);
  }
}




