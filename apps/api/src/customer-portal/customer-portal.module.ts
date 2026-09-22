import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { TenantPaymentsModule } from '../tenant-payments/tenant-payments.module';
import { TrackingModule } from '../tracking/tracking.module';
import { CustomerPortalController } from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';

/**
 * Tenant Payment Configuration Phase E: imports TenantPaymentsModule
 * directly (for TenantPaymentMethodsService.getEnabledForPortal), the
 * same "import this module directly for one unrelated concern" pattern
 * WebhooksModule already uses for TenantPaymentsStripeService's webhook-
 * signature verification — see TenantPaymentsModule's own doc comment.
 */
@Module({
  imports: [TrackingModule, InvoicesModule, PaymentsModule, TenantPaymentsModule, DocumentsModule, NotificationsModule],
  controllers: [CustomerPortalController],
  providers: [CustomerPortalService],
})
export class CustomerPortalModule {}
