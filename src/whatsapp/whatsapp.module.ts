import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { PrismaModule } from '../common/prisma/prisma.module';
import whatsappConfig from '../config/whatsapp.config';

@Module({
  imports: [PrismaModule, ConfigModule.forFeature(whatsappConfig)],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}

