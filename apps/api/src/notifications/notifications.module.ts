import { Module } from '@nestjs/common';
import { NotificationProvidersModule } from './providers/notification-providers.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [NotificationProvidersModule],
  controllers: [NotificationsController, WhatsAppWebhookController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
