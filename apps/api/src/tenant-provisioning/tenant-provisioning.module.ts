import { Module } from '@nestjs/common';
import { NotificationProvidersModule } from '../notifications/providers/notification-providers.module';
import { TenantProvisioningService } from './tenant-provisioning.service';

@Module({
  imports: [NotificationProvidersModule],
  providers: [TenantProvisioningService],
  exports: [TenantProvisioningService],
})
export class TenantProvisioningModule {}
