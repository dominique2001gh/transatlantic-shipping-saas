import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { StripeModule } from '../stripe/stripe.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { StripeWebhookLedgerService } from './stripe-webhook-ledger.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [StripeModule, PaymentsModule, SubscriptionsModule],
  controllers: [WebhooksController],
  providers: [StripeWebhookLedgerService],
})
export class WebhooksModule {}
