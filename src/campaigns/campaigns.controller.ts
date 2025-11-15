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
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('campaigns')
@Controller('campaigns')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new campaign' })
  create(
    @CurrentUser() user: any,
    @Body('companyId') companyId: string,
    @Body() createCampaignDto: CreateCampaignDto,
  ) {
    return this.campaignsService.create(companyId, user.id, createCampaignDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all campaigns for a company' })
  findAll(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.campaignsService.findAll(
      companyId,
      user.id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get campaign details' })
  findOne(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.campaignsService.findOne(companyId, user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update campaign' })
  update(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Param('id') id: string,
    @Body() updateData: Partial<CreateCampaignDto>,
  ) {
    return this.campaignsService.update(companyId, user.id, id, updateData);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete campaign' })
  delete(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.campaignsService.delete(companyId, user.id, id);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Start a campaign' })
  start(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.campaignsService.start(companyId, user.id, id);
  }
}

