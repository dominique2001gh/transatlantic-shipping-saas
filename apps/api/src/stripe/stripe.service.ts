import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Stage 3F: the only place the `stripe` SDK/API surface is touched
 * directly — every other service talks to this wrapper, never to Stripe
 * itself, the same delegation principle TrackingService/InvoicesService
 * already establish for their own single-owner concerns. `STRIPE_SECRET_KEY`
 * is read once at construction via `getOrThrow` — a missing key fails
 * fast at boot (module init), not on the first customer's checkout
 * attempt.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  readonly client: Stripe;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.client = new Stripe(secretKey);
  }

  /**
   * Creates a hosted Checkout Session for the given amount/currency — raw
   * card data never reaches this app at any point; Stripe's own page
   * collects it. `invoiceId` is stamped into `metadata` purely for
   * visibility when inspecting a session/event in the Stripe dashboard —
   * it is never read back by this app to make an authorization decision
   * (the Payment row's own `invoiceId` column is what every domain query
   * actually scopes by).
   */
  async createCheckoutSession(params: {
    amount: number;
    currency: string;
    invoiceId: string;
    invoiceNumber: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    return this.client.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: params.currency,
            unit_amount: params.amount,
            product_data: {
              name: `Invoice ${params.invoiceNumber}`,
            },
          },
        },
      ],
      metadata: { invoiceId: params.invoiceId, invoiceNumber: params.invoiceNumber },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
  }

  /**
   * Actively invalidates a session so it can never be completed (and
   * charged) after being superseded by a newer one — see
   * PaymentsService.createOnlineCheckoutSession's doc comment for why
   * this matters. Best-effort: a session that's already expired, already
   * completed, or otherwise no longer expirable makes Stripe's API
   * return an error, which is fine here — the goal ("this session can no
   * longer be paid") is already true in every one of those cases, so a
   * failure to *actively* expire it is never itself a problem worth
   * surfacing to the caller.
   */
  async expireCheckoutSession(sessionId: string): Promise<void> {
    try {
      await this.client.checkout.sessions.expire(sessionId);
    } catch (err) {
      this.logger.warn(`Could not expire Stripe session ${sessionId} (likely already completed/expired): ${err}`);
    }
  }

  /**
   * Verifies a webhook payload's signature against `STRIPE_WEBHOOK_SECRET`
   * and returns the parsed event. This is the entire security boundary
   * for the unauthenticated /webhooks/stripe route — throws on any
   * mismatch (wrong secret, tampered payload, expired timestamp), which
   * the controller turns into a 400. Must be called with the *raw*
   * request body bytes (see main.ts's `rawBody: true`); a JSON-parsed and
   * reserialized body cannot reproduce the signature Stripe computed over
   * what it actually sent.
   */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const webhookSecret = this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
    return this.client.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }
}
