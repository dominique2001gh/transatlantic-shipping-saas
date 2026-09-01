import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { StripeModule } from '../stripe/stripe.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [StripeModule, PaymentsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
