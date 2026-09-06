import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { NotificationProvidersModule } from '../notifications/providers/notification-providers.module';
import { PlatformLeadsController } from './platform-leads.controller';
import { PlatformLeadsService } from './platform-leads.service';
import { PublicPlatformLeadsController } from './public-platform-leads.controller';

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10 }]), NotificationProvidersModule],
  controllers: [PublicPlatformLeadsController, PlatformLeadsController],
  providers: [PlatformLeadsService],
})
export class PlatformLeadsModule {}
