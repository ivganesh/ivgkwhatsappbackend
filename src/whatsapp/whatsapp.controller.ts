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
import { ConnectWhatsAppDto } from './dto/connect-whatsapp.dto';
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

  @Get('webhook')
  @ApiExcludeEndpoint()
  async verifyWebhook(
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.mode') mode: string,
  ) {
    // Meta sends GET request for webhook verification
    if (mode === 'subscribe') {
      const expectedToken = this.configService.get<string>('whatsapp.webhookVerifyToken');
      console.log('🔍 Webhook verification request:', {
        mode,
        verifyToken: verifyToken ? 'provided' : 'missing',
        expectedToken: expectedToken ? 'configured' : 'missing',
        challenge: challenge ? 'provided' : 'missing',
      });

      if (!expectedToken) {
        console.error('❌ WHATSAPP_WEBHOOK_VERIFY_TOKEN not configured');
        throw new BadRequestException('Webhook verify token not configured');
      }

      if (verifyToken === expectedToken) {
        console.log('✅ Webhook verification successful');
        return challenge;
      }

      console.error('❌ Webhook verification failed: token mismatch');
      throw new BadRequestException('Invalid verify token');
    }

    throw new BadRequestException('Invalid verification mode');
  }

  @Post('webhook')
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Body() body: any,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    // Verify signature for POST requests (actual webhook events)
    if (signature) {
      const isValid = await this.whatsappService.verifyWebhookSignature(body, signature);
      if (!isValid) {
        console.error('❌ Invalid webhook signature');
        throw new BadRequestException('Invalid webhook signature');
      }
    }

    // Process webhook
    await this.whatsappService.handleWebhook(body);

    return { status: 'ok' };
  }

  @Post('connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Connect WhatsApp via Meta Embedded Signup' })
  async connectWhatsApp(
    @CurrentUser() user: any,
    @Body('companyId') companyId: string,
    @Body('code') code: string,
  ) {
    return this.whatsappService.connectWhatsApp(companyId, code);
  }

  @Post('configure-manual')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Manually configure WhatsApp credentials' })
  async configureManually(
    @CurrentUser() user: any,
    @Body('companyId') companyId: string,
    @Body('wabaId') wabaId: string,
    @Body('phoneNumberId') phoneNumberId: string,
    @Body('accessToken') accessToken: string,
    @Body('phoneNumber') phoneNumber?: string,
  ) {
    return this.whatsappService.configureManually(
      companyId,
      wabaId,
      phoneNumberId,
      accessToken,
      phoneNumber,
    );
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

  @Get('templates')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Fetch message templates from WhatsApp Business Account' })
  async getTemplates(
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
  ) {
    return this.whatsappService.getTemplates(companyId);
  }
}

