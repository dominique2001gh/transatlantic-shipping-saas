import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Per-invoice payment routes (POST/GET /invoices/:id/payments) stay
 * nested on InvoicesController, matching the established pattern of
 * nesting a sub-resource's routes on its parent controller (see
 * ShipmentsController's :id/items and :id/tracking-events) — that's why
 * InvoicesModule still imports this module for PaymentsService.
 * PaymentsController here only adds the Stage 3D tenant-wide GET
 * /payments list, which doesn't belong under /invoices. StripeModule
 * (Stage 3F) is imported here, not re-exported, since PaymentsService is
 * the only consumer of StripeService — WebhooksModule imports StripeModule
 * directly for its own, separate need (verifying webhook signatures).
 */
@Module({
  imports: [StripeModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
