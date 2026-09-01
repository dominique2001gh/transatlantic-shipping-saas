import { BadRequestException, Controller, Headers, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from '../payments/payments.service';
import { StripeService } from '../stripe/stripe.service';

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
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * Requires the *raw* request body (see main.ts's `rawBody: true` and
   * StripeService.constructWebhookEvent's own doc comment) — a
   * JSON-parsed-then-reserialized body cannot reproduce the signature
   * Stripe computed over the exact bytes it sent, so every event would be
   * rejected as tampered.
   *
   * Only reacts to `checkout.session.completed` with `payment_status:
   * 'paid'` — Stripe also sends `checkout.session.expired` and several
   * other event types to the same endpoint (Stripe webhooks are
   * fan-out-by-default: every subscribed event type arrives here, and a
   * handler is expected to ignore what it doesn't care about); anything
   * else is acknowledged with 200 and otherwise ignored, which is the
   * correct response — a webhook responding with a non-2xx to an event
   * it simply doesn't act on would just make Stripe retry it forever.
   * `PaymentsService.completeOnlinePayment` — not this controller — owns
   * every idempotency/ownership/amount concern from here on.
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === 'paid') {
        await this.paymentsService.completeOnlinePayment(session.id, new Date());
      }
    }

    return { received: true };
  }
}
