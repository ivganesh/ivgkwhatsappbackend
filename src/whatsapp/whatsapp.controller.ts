import {
  Controller,
  Post,
  Body,
  Param,
  Headers,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';

@ApiTags('whatsapp')
@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppService,
    private configService: ConfigService,
  ) {}

  @Post('webhook')
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Body() body: any,
    @Headers('x-hub-signature-256') signature: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.mode') mode: string,
  ) {
    // Webhook verification
    if (mode === 'subscribe') {
      const expectedToken = this.configService.get<string>('whatsapp.webhookVerifyToken');
      if (verifyToken === expectedToken) {
        return challenge;
      }
      throw new BadRequestException('Invalid verify token');
    }

    // Verify signature
    if (signature) {
      const isValid = await this.whatsappService.verifyWebhookSignature(body, signature);
      if (!isValid) {
        throw new BadRequestException('Invalid webhook signature');
      }
    }

    // Process webhook
    // Extract company ID from webhook data (you may need to map WABA ID to company)
    // For now, this is a placeholder
    // await this.whatsappService.handleWebhook(companyId, body);

    return { status: 'ok' };
  }

  @Post('send/text')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Send a text message via WhatsApp' })
  async sendTextMessage(
    @CurrentUser() user: any,
    @Body('companyId') companyId: string,
    @Body('phoneNumber') phoneNumber: string,
    @Body('message') message: string,
  ) {
    return this.whatsappService.sendTextMessage(companyId, phoneNumber, message);
  }

  @Post('send/template')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Send a template message via WhatsApp' })
  async sendTemplateMessage(
    @CurrentUser() user: any,
    @Body('companyId') companyId: string,
    @Body('phoneNumber') phoneNumber: string,
    @Body('templateName') templateName: string,
    @Body('languageCode') languageCode: string,
    @Body('components') components?: any[],
  ) {
    return this.whatsappService.sendTemplateMessage(
      companyId,
      phoneNumber,
      templateName,
      languageCode,
      components,
    );
  }

  @Post('send/media')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Send a media message via WhatsApp' })
  async sendMediaMessage(
    @CurrentUser() user: any,
    @Body('companyId') companyId: string,
    @Body('phoneNumber') phoneNumber: string,
    @Body('mediaUrl') mediaUrl: string,
    @Body('mediaType') mediaType: 'image' | 'video' | 'document' | 'audio',
    @Body('caption') caption?: string,
  ) {
    return this.whatsappService.sendMediaMessage(
      companyId,
      phoneNumber,
      mediaUrl,
      mediaType,
      caption,
    );
  }
}

