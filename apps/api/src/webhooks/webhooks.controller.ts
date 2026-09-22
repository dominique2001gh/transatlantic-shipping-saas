import { BadRequestException, Controller, Headers, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from '../payments/payments.service';
import { StripeService } from '../stripe/stripe.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TenantPaymentsStripeService } from '../tenant-payments/tenant-payments-stripe.service';
import { StripeWebhookLedgerService } from './stripe-webhook-ledger.service';

/**
 * Stage 3F: the only unauthenticated route in this API that can mutate
 * money state. Stripe signature verification (StripeService.
 * constructWebhookEvent, keyed by PLATFORM_STRIPE_WEBHOOK_SECRET) is the entire
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
    private readonly tenantPaymentsStripeService: TenantPaymentsStripeService,
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

  /**
   * Platform-billing vs. tenant-customer-payments separation (see
   * TenantPaymentsStripeService's own doc comment): events *from* a
   * tenant's own connected Stripe account arrive here instead of
   * /webhooks/stripe, verified against a separate
   * STRIPE_CONNECT_WEBHOOK_SECRET (Stripe issues a distinct signing secret
   * per registered endpoint — the platform-account secret would never
   * validate these). Currently dormant in every real environment: no
   * tenant has a connected account yet (TenantPaymentSettings has no rows
   * with stripeConnectedAccountId set), so this route exists, is tested,
   * and simply never fires until that changes.
   *
   * checkout.session.completed (a tenant's own customer making a one-time
   * invoice payment) and account.updated (Tenant Payments Phase 2:
   * connected-account readiness sync — see
   * TenantPaymentsStripeService.syncAccountStatusFromStripeAccount) are
   * both handled here. No connected-account counterpart to the
   * subscription-lifecycle branches above exists — a tenant's own
   * customers never subscribe to anything through this platform.
   *
   * Phase 2 policy on an inactive/unready connected account (resolves the
   * Phase 1 "the inbound lookup has no isActive filter" asymmetry,
   * documented and tested — see the inline check below): a
   * checkout.session.completed for an account whose TenantPaymentSettings
   * row is not currently `isActive` is acknowledged (so Stripe doesn't
   * retry it forever) but deliberately NOT auto-completed. The charge
   * genuinely succeeded on Stripe's side (session.payment_status is
   * already 'paid' by the time this fires) — the risk being guarded
   * against isn't a fake payment, it's this platform silently advancing
   * business state (invoice PAID, downstream notifications, etc.) for a
   * tenant whose payout account Stripe currently considers not ready
   * (restricted, under review, disabled) without a human ever looking at
   * it. The Payment row is left PENDING for manual staff reconciliation
   * rather than either auto-completing or silently discarding the money
   * having actually moved.
   */
  @Post('stripe-connect')
  @Public()
  async handleStripeConnectWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing Stripe signature or request body');
    }

    let event: Stripe.Event;
    try {
      event = this.tenantPaymentsStripeService.constructConnectWebhookEvent(req.rawBody, signature);
    } catch (err) {
      this.logger.warn(`Rejected Stripe Connect webhook with invalid signature: ${err}`);
      throw new BadRequestException('Invalid Stripe signature');
    }

    if (await this.webhookLedger.hasProcessed(event.id)) {
      this.logger.log(`Ignoring already-processed Stripe Connect webhook event ${event.id} (${event.type})`);
      return { received: true };
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === 'paid') {
        // event.account identifies which connected account this came
        // from; resolving it to a tenant here (rather than trusting
        // anything in the payload's own metadata) is what makes this
        // safe — the account id is Stripe's own verified attribution of
        // the event, not caller-supplied data.
        const connectedAccountId = event.account;
        const settings = connectedAccountId ? await this.tenantPaymentsStripeService.findTenantPaymentSettingsByConnectedAccountId(connectedAccountId) : null;
        if (!settings) {
          this.logger.warn(`Stripe Connect webhook for unrecognized account ${connectedAccountId ?? '(none)'} — ignoring`);
        } else if (!settings.isActive) {
          // See this method's own doc comment for why this is a
          // deliberate "leave PENDING for manual review", not a bug.
          this.logger.error(
            `Stripe Connect checkout.session.completed for session ${session.id} resolved to tenant ${settings.tenantId}, ` +
              `whose connected account ${connectedAccountId} is not currently active/ready — leaving the payment PENDING for manual reconciliation rather than auto-completing it.`,
          );
        } else {
          // Tenant Payments Phase 0: pass the securely-resolved tenantId
          // through so completeOnlinePayment can refuse to mutate a
          // payment belonging to a different tenant — see that method's
          // own doc comment.
          await this.paymentsService.completeOnlinePayment(session.id, new Date(), settings.tenantId);
        }
      }
    } else if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      const result = await this.tenantPaymentsStripeService.syncAccountStatusFromStripeAccount(account);
      if (!result) {
        this.logger.warn(`Stripe Connect account.updated for unrecognized account ${account.id} — ignoring`);
      } else {
        this.logger.log(`Synced connected account ${account.id} for tenant ${result.tenantId}: isActive=${result.isActive}`);
      }
    }

    await this.webhookLedger.markProcessed(event.id, event.type);

    return { received: true };
  }
}
