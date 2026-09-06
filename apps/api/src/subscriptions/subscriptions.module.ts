import { Module } from '@nestjs/common';
import { NotificationProvidersModule } from '../notifications/providers/notification-providers.module';
import { StripeModule } from '../stripe/stripe.module';
import { TenantProvisioningModule } from '../tenant-provisioning/tenant-provisioning.module';
import { BillingSchedulerService } from './billing-scheduler.service';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [StripeModule, TenantProvisioningModule, NotificationProvidersModule],
  providers: [SubscriptionsService, BillingSchedulerService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
