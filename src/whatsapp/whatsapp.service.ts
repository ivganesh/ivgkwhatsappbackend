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
    this.apiUrl =
      this.configService.get<string>('whatsapp.apiUrl') ||
      'https://graph.facebook.com/v23.0';
    this.apiVersion =
      this.configService.get<string>('whatsapp.apiVersion') || 'v23.0';
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

  private normalizePhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters except +
    let normalized = phoneNumber.replace(/[^\d+]/g, '');
    
    // If doesn't start with +, add it (assuming it's a valid number)
    if (!normalized.startsWith('+')) {
      // If starts with 0, remove it and add country code (default to +1 for US)
      if (normalized.startsWith('0')) {
        normalized = '+1' + normalized.substring(1);
      } else {
        normalized = '+' + normalized;
      }
    }
    
    return normalized;
  }

  /**
   * Check if contact has an active conversation window (within 24 hours)
   * WhatsApp allows free-form messages only within 24 hours of last user message
   */
  private async hasActiveConversationWindow(
    companyId: string,
    contactId: string,
  ): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: {
        companyId_contactId: {
          companyId,
          contactId,
        },
      },
    });

    if (!conversation || !conversation.lastMessageAt) {
      return false;
    }

    // Check if last message was within 24 hours
    const lastMessageTime = new Date(conversation.lastMessageAt);
    const now = new Date();
    const hoursSinceLastMessage =
      (now.getTime() - lastMessageTime.getTime()) / (1000 * 60 * 60);

    return hoursSinceLastMessage < 24;
  }

  /**
   * Check if contact has ever received a message from us
   */
  private async hasOutboundMessageHistory(
    companyId: string,
    contactId: string,
  ): Promise<boolean> {
    const outboundMessage = await this.prisma.message.findFirst({
      where: {
        companyId,
        contactId,
        direction: 'OUTBOUND',
        status: {
          in: ['SENT', 'DELIVERED', 'READ'],
        },
      },
    });

    return !!outboundMessage;
  }

  async sendTextMessage(
    companyId: string,
    phoneNumber: string,
    message: string,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (
      !company ||
      !company.whatsappConnected ||
      !company.whatsappAccessToken
    ) {
      throw new BadRequestException('WhatsApp not connected for this company');
    }

    const phoneNumberId = company.whatsappPhoneId;
    if (!phoneNumberId) {
      throw new BadRequestException('Phone number not configured');
    }

    // Normalize phone number to international format
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    
    // Validate phone number format (must start with + and have at least 10 digits)
    if (!/^\+\d{10,}$/.test(normalizedPhone)) {
      throw new BadRequestException(
        'Invalid phone number format. Please use international format (e.g., +1234567890)',
      );
    }

    // Find or create contact
    let contact = await this.prisma.contact.findUnique({
      where: {
        companyId_phone: {
          companyId,
          phone: normalizedPhone,
        },
      },
    });

    if (!contact) {
      contact = await this.prisma.contact.create({
        data: {
          companyId,
          phone: normalizedPhone,
        },
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
        },
      });
    }

    // Check if we can send free-form message (24-hour window rule)
    const hasActiveWindow = await this.hasActiveConversationWindow(
      companyId,
      contact.id,
    );
    const hasMessageHistory = await this.hasOutboundMessageHistory(
      companyId,
      contact.id,
    );

    // If no active window and no previous outbound messages, require template
    if (!hasActiveWindow && !hasMessageHistory) {
      throw new BadRequestException(
        'Cannot send free-form message. You must send a template message first to start a conversation. ' +
          'After the recipient responds, you can send free-form messages within 24 hours.',
      );
    }

    const apiClient = this.getApiClient(company.whatsappAccessToken);

    try {
      const response = await apiClient.post(`/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone,
        type: 'text',
        text: {
          body: message,
        },
      });

      // Verify response structure
      if (!response.data || !response.data.messages || !response.data.messages[0]) {
        throw new BadRequestException(
          'Invalid response from WhatsApp API. Message may not have been sent.',
        );
      }

      const whatsappMessageId = response.data.messages[0].id;
      const responseStatus = response.data.messages[0].message_status;

      if (!whatsappMessageId) {
        throw new BadRequestException(
          'Message ID not received from WhatsApp. Message may not have been sent.',
        );
      }

      // Update conversation last message time
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      // Save message to database for status tracking
      const savedMessage = await this.prisma.message.create({
        data: {
          companyId,
          contactId: contact.id,
          conversationId: conversation.id,
          whatsappMessageId,
          type: 'TEXT',
          direction: 'OUTBOUND',
          content: message,
          status: 'SENT', // Will be updated via webhook
          sentAt: new Date(),
        },
      });

      console.log(
        `✅ Message sent successfully: ${whatsappMessageId} to ${normalizedPhone}`,
      );

      return {
        success: true,
        messageId: savedMessage.id,
        whatsappMessageId,
        phoneNumber: normalizedPhone,
        status: 'SENT',
        note: 'Message sent. Delivery status will be updated via webhook.',
      };
    } catch (error: any) {
      // Save failed message to database
      await this.prisma.message.create({
        data: {
          companyId,
          contactId: contact.id,
          conversationId: conversation.id,
          type: 'TEXT',
          direction: 'OUTBOUND',
          content: message,
          status: 'FAILED',
          error: error.response?.data?.error?.message || 'Failed to send message',
          sentAt: new Date(),
        },
      });

      const errorMessage = error.response?.data?.error?.message || 'Failed to send message';
      const errorCode = error.response?.data?.error?.code;
      const errorSubcode = error.response?.data?.error?.error_subcode;

      console.error('❌ Message send failed:', {
        errorCode,
        errorSubcode,
        errorMessage,
        phoneNumber: normalizedPhone,
      });

      // Provide more specific error messages based on WhatsApp error codes
      if (errorCode === 131047) {
        throw new BadRequestException(
          'Phone number is not registered on WhatsApp. Please ensure the recipient has WhatsApp installed.',
        );
      } else if (errorCode === 131026) {
        throw new BadRequestException(
          'Message failed to send. The recipient may have blocked your number or the number is invalid.',
        );
      } else if (errorCode === 131051) {
        // 24-hour window expired
        throw new BadRequestException(
          'Cannot send free-form message. The 24-hour conversation window has expired. ' +
            'Please send a template message first to start a new conversation.',
        );
      } else if (errorCode === 131031) {
        // Rate limit
        throw new BadRequestException(
          'Rate limit exceeded. Please wait before sending more messages.',
        );
      } else if (errorCode === 131048) {
        // Invalid phone number
        throw new BadRequestException(
          'Invalid phone number format. Please use international format (e.g., +1234567890).',
        );
      } else if (error.response?.status === 429) {
        throw new BadRequestException(
          'Rate limit exceeded. Please wait before sending more messages.',
        );
      } else if (errorCode === 131000) {
        // Generic error - check subcode
        if (errorSubcode === 131031) {
          throw new BadRequestException(
            'Cannot send message. You must send a template message first to start a conversation.',
          );
        }
      }

      throw new BadRequestException(
        errorMessage || 'Failed to send message. Please check the phone number and try again.',
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

    if (
      !company ||
      !company.whatsappConnected ||
      !company.whatsappAccessToken
    ) {
      throw new BadRequestException('WhatsApp not connected for this company');
    }

    const phoneNumberId = company.whatsappPhoneId;
    if (!phoneNumberId) {
      throw new BadRequestException('Phone number not configured');
    }

    // Normalize phone number
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    
    // Validate phone number format
    if (!/^\+\d{10,}$/.test(normalizedPhone)) {
      throw new BadRequestException(
        'Invalid phone number format. Please use international format (e.g., +1234567890)',
      );
    }

    // Find or create contact
    let contact = await this.prisma.contact.findUnique({
      where: {
        companyId_phone: {
          companyId,
          phone: normalizedPhone,
        },
      },
    });

    if (!contact) {
      contact = await this.prisma.contact.create({
        data: {
          companyId,
          phone: normalizedPhone,
        },
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
        },
      });
    }

    const apiClient = this.getApiClient(company.whatsappAccessToken);

    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone,
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

      const response = await apiClient.post(
        `/${phoneNumberId}/messages`,
        payload,
      );

      // Verify response structure
      if (!response.data || !response.data.messages || !response.data.messages[0]) {
        throw new BadRequestException(
          'Invalid response from WhatsApp API. Template message may not have been sent.',
        );
      }

      const whatsappMessageId = response.data.messages[0].id;

      if (!whatsappMessageId) {
        throw new BadRequestException(
          'Message ID not received from WhatsApp. Template message may not have been sent.',
        );
      }

      // Update conversation last message time
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      // Save template message to database
      const savedMessage = await this.prisma.message.create({
        data: {
          companyId,
          contactId: contact.id,
          conversationId: conversation.id,
          whatsappMessageId,
          type: 'TEMPLATE',
          direction: 'OUTBOUND',
          content: `Template: ${templateName}`,
          status: 'SENT', // Will be updated via webhook
          sentAt: new Date(),
        },
      });

      console.log(
        `✅ Template message sent successfully: ${whatsappMessageId} to ${normalizedPhone}`,
      );

      return {
        success: true,
        messageId: savedMessage.id,
        whatsappMessageId,
        phoneNumber: normalizedPhone,
        templateName,
        status: 'SENT',
        note: 'Template message sent. Delivery status will be updated via webhook.',
      };
    } catch (error: any) {
      // Save failed message to database
      await this.prisma.message.create({
        data: {
          companyId,
          contactId: contact.id,
          conversationId: conversation.id,
          type: 'TEMPLATE',
          direction: 'OUTBOUND',
          content: `Template: ${templateName}`,
          status: 'FAILED',
          error: error.response?.data?.error?.message || 'Failed to send template message',
          sentAt: new Date(),
        },
      });

      const errorMessage = error.response?.data?.error?.message || 'Failed to send template message';
      const errorCode = error.response?.data?.error?.code;

      console.error('❌ Template message send failed:', {
        errorCode,
        errorMessage,
        phoneNumber: normalizedPhone,
        templateName,
        languageCode,
      });

      // Provide specific error messages for template errors
      if (errorCode === 132001) {
        throw new BadRequestException(
          `Template "${templateName}" does not exist in language "${languageCode}". ` +
            `Please check the template's available languages in Meta Business Manager. ` +
            `The template may be available in a different language code (e.g., en_US instead of en).`,
        );
      } else if (errorCode === 132000) {
        throw new BadRequestException(
          `Template "${templateName}" not found or not approved. Please verify the template exists and is approved in Meta Business Manager.`,
        );
      } else if (errorCode === 131047) {
        throw new BadRequestException(
          'Phone number is not registered on WhatsApp. Please ensure the recipient has WhatsApp installed.',
        );
      } else if (errorCode === 131026) {
        throw new BadRequestException(
          'Message failed to send. The recipient may have blocked your number or the number is invalid.',
        );
      }

      throw new BadRequestException(errorMessage);
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

    if (
      !company ||
      !company.whatsappConnected ||
      !company.whatsappAccessToken
    ) {
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

      const response = await apiClient.post(
        `/${phoneNumberId}/messages`,
        payload,
      );

      return response.data;
    } catch (error: any) {
      throw new BadRequestException(
        error.response?.data?.error?.message || 'Failed to send media message',
      );
    }
  }

  async connectWhatsApp(companyId: string, code: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new BadRequestException('Company not found');
    }

    // Exchange code for access token
    const appId = this.configService.get<string>('whatsapp.appId');
    const appSecret = this.configService.get<string>('whatsapp.appSecret');

    if (!appId || !appSecret) {
      throw new BadRequestException('WhatsApp app credentials not configured');
    }

    try {
      // Step 1: Exchange code for access token
      const tokenResponse = await axios.post(
        `${this.apiUrl}/oauth/access_token`,
        {
          client_id: appId,
          client_secret: appSecret,
          code: code,
        },
      );

      const accessToken = tokenResponse.data.access_token;

      // Step 2: Get WABA and phone number info
      const wabaResponse = await axios.get(`${this.apiUrl}/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          fields: 'whatsapp_business_account',
        },
      });

      const wabaId = wabaResponse.data.whatsapp_business_account?.id;

      if (!wabaId) {
        throw new BadRequestException(
          'Failed to get WhatsApp Business Account ID',
        );
      }

      // Step 3: Get phone numbers
      const phoneNumbersResponse = await axios.get(
        `${this.apiUrl}/${wabaId}/phone_numbers`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const phoneNumbers = phoneNumbersResponse.data.data;
      if (!phoneNumbers || phoneNumbers.length === 0) {
        throw new BadRequestException('No phone numbers found for this WABA');
      }

      const primaryPhone = phoneNumbers[0];

      // Step 4: Store credentials in company
      await this.prisma.company.update({
        where: { id: companyId },
        data: {
          whatsappBusinessId: wabaId,
          whatsappPhoneId: primaryPhone.id,
          whatsappAccessToken: accessToken,
          whatsappConnected: true,
        },
      });

      // Step 5: Store phone number details
      await this.prisma.phoneNumber.upsert({
        where: {
          companyId_phoneNumberId: {
            companyId,
            phoneNumberId: primaryPhone.id,
          },
        },
        create: {
          companyId,
          phoneNumberId: primaryPhone.id,
          phoneNumber:
            primaryPhone.display_phone_number ||
            primaryPhone.verified_name ||
            '',
          displayName: primaryPhone.verified_name || '',
          qualityRating: primaryPhone.quality_rating || null,
          messagingTier: primaryPhone.messaging_product_tier || null,
          isDefault: true,
          isActive: true,
        },
        update: {
          phoneNumber:
            primaryPhone.display_phone_number ||
            primaryPhone.verified_name ||
            '',
          displayName: primaryPhone.verified_name || '',
          qualityRating: primaryPhone.quality_rating || null,
          messagingTier: primaryPhone.messaging_product_tier || null,
          isDefault: true,
        },
      });

      // Step 6: Subscribe to webhooks
      try {
        await axios.post(
          `${this.apiUrl}/${wabaId}/subscribed_apps`,
          {},
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
      } catch (error) {
        // Webhook subscription might fail, but we can continue
        console.warn('Failed to subscribe to webhooks:', error);
      }

      return {
        success: true,
        wabaId,
        phoneNumberId: primaryPhone.id,
        phoneNumber:
          primaryPhone.display_phone_number || primaryPhone.verified_name,
      };
    } catch (error: any) {
      throw new BadRequestException(
        error.response?.data?.error?.message || 'Failed to connect WhatsApp',
      );
    }
  }

  async configureManually(
    companyId: string,
    wabaId: string,
    phoneNumberId: string,
    accessToken: string,
    phoneNumber?: string,
  ) {
    // Validate company exists
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new BadRequestException('Company not found');
    }

    // Validate credentials by fetching phone number details
    const apiClient = this.getApiClient(accessToken);

    try {
      // Test the connection by fetching phone number details
      const phoneResponse = await apiClient.get(`/${phoneNumberId}`);
      const phoneData = phoneResponse.data;

      // Verify WABA ID matches
      if (phoneData.verified_name?.id && phoneData.verified_name.id !== wabaId) {
        throw new BadRequestException(
          'Phone Number ID does not belong to the provided WABA ID',
        );
      }

      // Fetch WABA details to verify (optional - just to validate the WABA exists)
      try {
        await apiClient.get(`/${wabaId}`);
      } catch (wabaError) {
        // If WABA doesn't exist, this will throw, but we continue with phone number validation
        console.warn('WABA validation warning:', wabaError);
      }

      // Additional validation: Try to fetch templates to verify token has proper permissions
      try {
        await apiClient.get(`/${wabaId}/message_templates?limit=1`);
      } catch (templateError: any) {
        // If we can't fetch templates, the token might not have proper permissions
        // But we'll still allow the connection - just log a warning
        console.warn('Template fetch validation warning:', templateError.response?.data?.error?.message || 'Cannot verify template access');
      }

      // Store credentials in company
      await this.prisma.company.update({
        where: { id: companyId },
        data: {
          whatsappBusinessId: wabaId,
          whatsappPhoneId: phoneNumberId,
          whatsappAccessToken: accessToken,
          whatsappConnected: true,
        },
      });

      // Store phone number details
      const displayPhoneNumber =
        phoneNumber ||
        phoneData.display_phone_number ||
        phoneData.verified_name?.display_phone_number ||
        '';

      await this.prisma.phoneNumber.upsert({
        where: {
          companyId_phoneNumberId: {
            companyId,
            phoneNumberId,
          },
        },
        create: {
          companyId,
          phoneNumberId,
          phoneNumber: displayPhoneNumber,
          displayName: phoneData.verified_name?.display_name || '',
          qualityRating: phoneData.quality_rating || null,
          messagingTier: phoneData.messaging_product_tier || null,
          isDefault: true,
          isActive: true,
        },
        update: {
          phoneNumber: displayPhoneNumber,
          displayName: phoneData.verified_name?.display_name || '',
          qualityRating: phoneData.quality_rating || null,
          messagingTier: phoneData.messaging_product_tier || null,
          isDefault: true,
        },
      });

      // Subscribe to webhooks
      try {
        await apiClient.post(
          `${this.apiUrl}/${wabaId}/subscribed_apps`,
          {},
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
      } catch (error) {
        // Webhook subscription might fail, but we can continue
        console.warn('Failed to subscribe to webhooks:', error);
      }

      return {
        success: true,
        wabaId,
        phoneNumberId,
        phoneNumber: displayPhoneNumber,
        displayName: phoneData.verified_name?.display_name || '',
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new BadRequestException('Invalid access token');
      }
      if (error.response?.status === 404) {
        throw new BadRequestException(
          'Phone Number ID or WABA ID not found. Please verify your credentials.',
        );
      }
      throw new BadRequestException(
        error.response?.data?.error?.message ||
          'Failed to validate WhatsApp credentials',
      );
    }
  }

  async getTemplates(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (
      !company ||
      !company.whatsappConnected ||
      !company.whatsappAccessToken ||
      !company.whatsappBusinessId
    ) {
      throw new BadRequestException('WhatsApp not connected for this company');
    }

    const apiClient = this.getApiClient(company.whatsappAccessToken);

    try {
      // Fetch templates from Meta's API
      const response = await apiClient.get(
        `/${company.whatsappBusinessId}/message_templates`,
      );

      return {
        success: true,
        templates: response.data.data || [],
        paging: response.data.paging || null,
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new BadRequestException('Invalid access token');
      }
      if (error.response?.status === 404) {
        throw new BadRequestException('WhatsApp Business Account not found');
      }
      throw new BadRequestException(
        error.response?.data?.error?.message ||
          'Failed to fetch templates from WhatsApp',
      );
    }
  }

  async verifyWebhookSignature(
    payload: any,
    signature: string,
  ): Promise<boolean> {
    const appSecret = this.configService.get<string>(
      'whatsapp.webhookAppSecret',
    );
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

  async handleWebhook(webhookData: any) {
    // Process incoming webhook from Meta
    // This will handle incoming messages, status updates, etc.

    console.log('📥 Webhook received:', JSON.stringify(webhookData, null, 2));

    if (webhookData.entry) {
      for (const entry of webhookData.entry) {
        if (entry.changes) {
          for (const change of entry.changes) {
            const value = change.value;

            // Find company by Phone Number ID
            if (value?.metadata?.phone_number_id) {
              const company = await this.prisma.company.findFirst({
                where: {
                  whatsappPhoneId: value.metadata.phone_number_id,
                },
              });

              if (!company) {
                console.warn(
                  '⚠️ Company not found for phone number:',
                  value.metadata.phone_number_id,
                );
                continue;
              }

              console.log(`✅ Processing webhook for company: ${company.id}`);

              if (value.messages) {
                console.log(`📨 Processing ${value.messages.length} incoming message(s)`);
                // Handle incoming messages
                await this.processIncomingMessages(company.id, value.messages);
              }

              if (value.statuses) {
                console.log(`📊 Processing ${value.statuses.length} status update(s)`);
                // Handle message status updates
                await this.processStatusUpdates(company.id, value.statuses);
              }
            } else {
              console.warn('⚠️ Webhook missing phone_number_id in metadata');
            }
          }
        }
      }
    } else {
      console.warn('⚠️ Webhook missing entry data');
    }
  }

  private async processIncomingMessages(companyId: string, messages: any[]) {
    for (const message of messages) {
      const rawPhone = message.from;
      const messageId = message.id;
      const messageType = message.type;
      const timestamp = parseInt(message.timestamp) * 1000;

      if (!rawPhone) {
        console.warn('⚠️ Incoming message missing sender phone number');
        continue;
      }

      // Normalize phone number to ensure consistency with outbound messages
      const contactPhone = this.normalizePhoneNumber(rawPhone);

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
      } else if (
        ['image', 'video', 'document', 'audio'].includes(messageType)
      ) {
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

      console.log(`📊 Updating message status: ${messageId} -> ${messageStatus}`);

      // Update message status
      const updateResult = await this.prisma.message.updateMany({
        where: {
          companyId,
          whatsappMessageId: messageId,
        },
        data: {
          status: this.mapWhatsAppStatus(messageStatus),
          ...(messageStatus === 'delivered' && { deliveredAt: new Date() }),
          ...(messageStatus === 'read' && { readAt: new Date() }),
          ...(messageStatus === 'failed' && {
            error: status.errors?.[0]?.message || 'Message delivery failed',
          }),
        },
      });

      if (updateResult.count === 0) {
        console.warn(
          `⚠️ No message found with WhatsApp ID: ${messageId} for company: ${companyId}`,
        );
      } else {
        console.log(
          `✅ Updated ${updateResult.count} message(s) with status: ${messageStatus}`,
        );
      }
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
