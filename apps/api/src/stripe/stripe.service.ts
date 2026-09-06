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
   * AnanseLogix Phase 1: creates a `mode: 'subscription'` Checkout Session
   * for the self-service signup wizard — the subscription-billing
   * counterpart to createCheckoutSession's one-time invoice payment above.
   * Same ad-hoc `price_data` approach (no pre-created Stripe Product/Price
   * objects to keep in sync with SaasPlanPrice — see that model's own doc
   * comment) but with `recurring` set on the monthly line item. The
   * optional one-time setup-fee line item is charged on the same first
   * invoice Stripe generates for the subscription — Stripe Checkout
   * natively supports mixing one non-recurring price with a recurring one
   * in a single subscription-mode session.
   *
   * `metadata.signupSessionToken` is how the webhook handler
   * (SubscriptionsService.handleCheckoutCompleted) finds its way back to
   * the SignupSession row that staged this signup — the same
   * "metadata for traceability, never for authorization" posture
   * createCheckoutSession's own doc comment establishes (the authoritative
   * link is SignupSession.stripeCheckoutSessionId, set by the caller
   * immediately after this returns).
   */
  async createSubscriptionCheckoutSession(params: {
    signupSessionToken: string;
    customerEmail: string;
    planName: string;
    currency: string;
    monthlyAmountCents: number;
    setupFeeCents: number;
    trialDays: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: params.currency,
          unit_amount: params.monthlyAmountCents,
          recurring: { interval: 'month' },
          product_data: { name: `${params.planName} — Monthly Subscription` },
        },
      },
    ];
    if (params.setupFeeCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: params.currency,
          unit_amount: params.setupFeeCents,
          product_data: { name: `${params.planName} — One-time Setup Fee` },
        },
      });
    }

    return this.client.checkout.sessions.create({
      mode: 'subscription',
      customer_email: params.customerEmail,
      line_items: lineItems,
      subscription_data: params.trialDays > 0 ? { trial_period_days: params.trialDays } : undefined,
      metadata: { signupSessionToken: params.signupSessionToken },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
  }

  /**
   * AnanseLogix Phase 1: fetches the full Subscription object right after
   * checkout completes — the Checkout Session itself only carries the
   * subscription id, not its status/period dates/trial end, all of which
   * TenantProvisioningService needs to populate the new TenantSubscription
   * row correctly on the very first write (rather than waiting for a
   * subsequent customer.subscription.updated event to backfill them).
   */
  async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.client.subscriptions.retrieve(subscriptionId);
  }

  /**
   * AnanseLogix Phase 1: creates a Stripe-hosted Billing Portal session so
   * a tenant owner can manage their own payment method/invoice
   * history/cancellation (Section 9's "Stripe Customer Portal") without
   * this app building any of that UI itself — Stripe's own hosted page
   * handles it, the same "let Stripe's page collect it" principle
   * createCheckoutSession's own doc comment already establishes for card
   * data.
   */
  async createBillingPortalSession(customerId: string, returnUrl: string): Promise<Stripe.BillingPortal.Session> {
    return this.client.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
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
