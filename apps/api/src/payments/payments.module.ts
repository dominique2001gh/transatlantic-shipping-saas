import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Per-invoice payment routes (POST/GET /invoices/:id/payments) stay
 * nested on InvoicesController, matching the established pattern of
 * nesting a sub-resource's routes on its parent controller (see
 * ShipmentsController's :id/items and :id/tracking-events) — that's why
 * InvoicesModule still imports this module for PaymentsService.
 * PaymentsController here only adds the Stage 3D tenant-wide GET
 * /payments list, which doesn't belong under /invoices.
 */
@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
