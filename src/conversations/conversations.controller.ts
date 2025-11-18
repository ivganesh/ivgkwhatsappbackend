import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('conversations')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'List all conversations for a company' })
  findAll(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversationsService.findAll(
      companyId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('messages')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  getMessages(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Query('contactId') contactId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversationsService.getMessages(
      companyId,
      contactId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get(':contactId')
  @ApiOperation({ summary: 'Get conversation details with contact' })
  findOne(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.conversationsService.findOne(companyId, contactId);
  }
}

