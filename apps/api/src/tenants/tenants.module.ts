import { Module } from '@nestjs/common';
import { NotificationProvidersModule } from '../notifications/providers/notification-providers.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [NotificationProvidersModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
