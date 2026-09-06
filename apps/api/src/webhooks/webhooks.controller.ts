import { BadRequestException, Controller, Headers, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from '../payments/payments.service';
import { StripeService } from '../stripe/stripe.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { StripeWebhookLedgerService } from './stripe-webhook-ledger.service';

/**
 * Stage 3F: the only unauthenticated route in this API that can mutate
 * money state. Stripe signature verification (StripeService.
 * constructWebhookEvent, keyed by STRIPE_WEBHOOK_SECRET) is the entire
 * security boundary here, replacing the JWT every other route relies on
 * — @Public() is correct and deliberate, not an oversight (see
 * roles-guard-contract.e2e-spec.ts, which requires every route to declare
 * one of @Roles()/@Public()/@AnyAuthenticatedRole() explicitly, so a
 * route missing all three fails that suite rather than silently becoming
 * reachable — or unreachable — by accident).
 *
 * AnanseLogix Phase 1 adds subscription-billing event handling alongside
 * the original one-time invoice-payment handling below — see
 * StripeWebhookLedgerService's own doc comment for the added idempotency
 * layer, and SubscriptionsService for everything those branches delegate
 * to. `checkout.session.completed` is emitted for *both* flows (one-time
 * `mode: 'payment'` invoice checkouts and `mode: 'subscription'` signup
 * checkouts); `session.mode` disambiguates which handler owns it.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly paymentsService: PaymentsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly webhookLedger: StripeWebhookLedgerService,
  ) {}

  /**
   * Requires the *raw* request body (see main.ts's `rawBody: true` and
   * StripeService.constructWebhookEvent's own doc comment) — a
   * JSON-parsed-then-reserialized body cannot reproduce the signature
   * Stripe computed over the exact bytes it sent, so every event would be
   * rejected as tampered.
   *
   * Stripe webhooks are fan-out-by-default: every subscribed event type
   * arrives here, and a handler is expected to ignore what it doesn't act
   * on — anything not explicitly handled below is acknowledged with 200
   * and otherwise ignored, which is the correct response (a non-2xx to an
   * event this app simply doesn't use would just make Stripe retry it
   * forever).
   */
  @Post('stripe')
  @Public()
  async handleStripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing Stripe signature or request body');
    }

    let event: Stripe.Event;
    try {
      event = this.stripeService.constructWebhookEvent(req.rawBody, signature);
    } catch (err) {
      this.logger.warn(`Rejected Stripe webhook with invalid signature: ${err}`);
      throw new BadRequestException('Invalid Stripe signature');
    }

    if (await this.webhookLedger.hasProcessed(event.id)) {
      this.logger.log(`Ignoring already-processed Stripe webhook event ${event.id} (${event.type})`);
      return { received: true };
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription') {
          await this.subscriptionsService.handleCheckoutCompleted(session);
        } else if (session.payment_status === 'paid') {
          await this.paymentsService.completeOnlinePayment(session.id, new Date());
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.subscriptionsService.handleSubscriptionUpdated(event.data.object as Stripe.Subscription, event.type);
        break;
      case 'invoice.paid':
        await this.subscriptionsService.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await this.subscriptionsService.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        break;
    }

    // Marked after successful processing — see StripeWebhookLedgerService's
    // own doc comment for why mark-after (not mark-before) is the safe order.
    await this.webhookLedger.markProcessed(event.id, event.type);

    return { received: true };
  }
}
