import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class WhatsAppService {
  private apiUrl: string;
  private apiVersion: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiUrl = this.configService.get<string>('whatsapp.apiUrl') || 'https://graph.facebook.com/v18.0';
    this.apiVersion = this.configService.get<string>('whatsapp.apiVersion') || 'v18.0';
  }

  private getApiClient(accessToken: string): AxiosInstance {
    return axios.create({
      baseURL: this.apiUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async sendTextMessage(
    companyId: string,
    phoneNumber: string,
    message: string,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company || !company.whatsappConnected || !company.whatsappAccessToken) {
      throw new BadRequestException('WhatsApp not connected for this company');
    }

    const phoneNumberId = company.whatsappPhoneId;
    if (!phoneNumberId) {
      throw new BadRequestException('Phone number not configured');
    }

    const apiClient = this.getApiClient(company.whatsappAccessToken);

    try {
      const response = await apiClient.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'text',
        text: {
          body: message,
        },
      });

      return response.data;
    } catch (error: any) {
      throw new BadRequestException(
        error.response?.data?.error?.message || 'Failed to send message',
      );
    }
  }

  async sendTemplateMessage(
    companyId: string,
    phoneNumber: string,
    templateName: string,
    languageCode: string,
    components?: any[],
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company || !company.whatsappConnected || !company.whatsappAccessToken) {
      throw new BadRequestException('WhatsApp not connected for this company');
    }

    const phoneNumberId = company.whatsappPhoneId;
    if (!phoneNumberId) {
      throw new BadRequestException('Phone number not configured');
    }

    const apiClient = this.getApiClient(company.whatsappAccessToken);

    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: languageCode,
          },
        },
      };

      if (components && components.length > 0) {
        payload.template.components = components;
      }

      const response = await apiClient.post(`/${phoneNumberId}/messages`, payload);

      return response.data;
    } catch (error: any) {
      throw new BadRequestException(
        error.response?.data?.error?.message || 'Failed to send template message',
      );
    }
  }

  async sendMediaMessage(
    companyId: string,
    phoneNumber: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' | 'document' | 'audio',
    caption?: string,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company || !company.whatsappConnected || !company.whatsappAccessToken) {
      throw new BadRequestException('WhatsApp not connected for this company');
    }

    const phoneNumberId = company.whatsappPhoneId;
    if (!phoneNumberId) {
      throw new BadRequestException('Phone number not configured');
    }

    const apiClient = this.getApiClient(company.whatsappAccessToken);

    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: mediaType,
        [mediaType]: {
          link: mediaUrl,
        },
      };

      if (caption && (mediaType === 'image' || mediaType === 'video')) {
        payload[mediaType].caption = caption;
      }

      const response = await apiClient.post(`/${phoneNumberId}/messages`, payload);

      return response.data;
    } catch (error: any) {
      throw new BadRequestException(
        error.response?.data?.error?.message || 'Failed to send media message',
      );
    }
  }

  async verifyWebhookSignature(payload: any, signature: string): Promise<boolean> {
    const appSecret = this.configService.get<string>('whatsapp.webhookAppSecret');
    if (!appSecret) {
      return false;
    }

    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', appSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return signature === `sha256=${expectedSignature}`;
  }

  async handleWebhook(companyId: string, webhookData: any) {
    // Process incoming webhook from Meta
    // This will handle incoming messages, status updates, etc.
    // Implementation depends on webhook structure from Meta

    if (webhookData.entry) {
      for (const entry of webhookData.entry) {
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.value?.messages) {
              // Handle incoming messages
              await this.processIncomingMessages(companyId, change.value.messages);
            }
            if (change.value?.statuses) {
              // Handle message status updates
              await this.processStatusUpdates(companyId, change.value.statuses);
            }
          }
        }
      }
    }
  }

  private async processIncomingMessages(companyId: string, messages: any[]) {
    for (const message of messages) {
      const contactPhone = message.from;
      const messageId = message.id;
      const messageType = message.type;
      const timestamp = parseInt(message.timestamp) * 1000;

      // Find or create contact
      let contact = await this.prisma.contact.findUnique({
        where: {
          companyId_phone: {
            companyId,
            phone: contactPhone,
          },
        },
      });

      if (!contact) {
        contact = await this.prisma.contact.create({
          data: {
            companyId,
            phone: contactPhone,
            lastMessageAt: new Date(timestamp),
          },
        });
      } else {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { lastMessageAt: new Date(timestamp) },
        });
      }

      // Find or create conversation
      let conversation = await this.prisma.conversation.findUnique({
        where: {
          companyId_contactId: {
            companyId,
            contactId: contact.id,
          },
        },
      });

      if (!conversation) {
        conversation = await this.prisma.conversation.create({
          data: {
            companyId,
            contactId: contact.id,
            status: 'OPEN',
            lastMessageAt: new Date(timestamp),
          },
        });
      } else {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            status: 'OPEN',
            lastMessageAt: new Date(timestamp),
          },
        });
      }

      // Extract message content based on type
      let content = '';
      let mediaUrl = null;
      let mediaType = null;

      if (messageType === 'text') {
        content = message.text?.body || '';
      } else if (['image', 'video', 'document', 'audio'].includes(messageType)) {
        mediaUrl = message[messageType]?.id;
        mediaType = messageType.toUpperCase();
        content = message[messageType]?.caption || '';
      }

      // Save message
      await this.prisma.message.create({
        data: {
          companyId,
          contactId: contact.id,
          conversationId: conversation.id,
          whatsappMessageId: messageId,
          type: messageType.toUpperCase() as any,
          direction: 'INBOUND',
          content,
          mediaUrl,
          mediaType,
          status: 'DELIVERED',
          sentAt: new Date(timestamp),
          deliveredAt: new Date(timestamp),
        },
      });
    }
  }

  private async processStatusUpdates(companyId: string, statuses: any[]) {
    for (const status of statuses) {
      const messageId = status.id;
      const messageStatus = status.status;

      // Update message status
      await this.prisma.message.updateMany({
        where: {
          companyId,
          whatsappMessageId: messageId,
        },
        data: {
          status: this.mapWhatsAppStatus(messageStatus),
          ...(messageStatus === 'delivered' && { deliveredAt: new Date() }),
          ...(messageStatus === 'read' && { readAt: new Date() }),
          ...(messageStatus === 'failed' && { error: status.errors?.[0]?.message }),
        },
      });
    }
  }

  private mapWhatsAppStatus(status: string): any {
    const statusMap: Record<string, any> = {
      sent: 'SENT',
      delivered: 'DELIVERED',
      read: 'READ',
      failed: 'FAILED',
    };
    return statusMap[status] || 'SENT';
  }
}

