import { registerAs } from '@nestjs/config';

export default registerAs('whatsapp', () => ({
  appId: process.env.META_APP_ID,
  appSecret: process.env.META_APP_SECRET,
  configId: process.env.META_CONFIG_ID,
  webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  webhookAppSecret: process.env.WHATSAPP_APP_SECRET,
  apiVersion: process.env.WHATSAPP_API_VERSION || 'v23.0',
  apiUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v23.0',
}));
