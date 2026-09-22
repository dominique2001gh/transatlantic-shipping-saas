import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

/**
 * Platform-billing vs. tenant-customer-payments separation (see
 * TenantPaymentSettings's own schema doc comment for the full
 * architecture). This is the ONLY place a tenant's own customer invoice
 * payments touch Stripe — StripeService stays scoped to (A) platform
 * billing (signup subscriptions, setup fees, the billing portal) and is
 * never used for (B) a tenant's own customers paying that tenant.
 *
 * Deliberately does not hold its own `Stripe` client or read
 * PLATFORM_STRIPE_SECRET_KEY itself: with Stripe Connect, every API call — for the
 * platform's own account *and* for every connected tenant — is made with
 * the platform's own secret key; a connected tenant's calls just add a
 * `{ stripeAccount: <their connected account id> }` request option. So
 * this wraps StripeService.client rather than duplicating key-reading
 * logic, while still being a logically distinct service with its own
 * tenant-resolution step — the two concerns can now evolve (and be
 * security-reviewed) independently even though they share one
 * underlying SDK client today.
 *
 * Tenant Payments Phase 1: the approved connected-account architecture
 * is Express accounts onboarded via Stripe-hosted Account Links (not
 * OAuth) — see TenantPaymentSettings's own schema doc comment for the
 * full decision record. Nothing in this service depends on which
 * onboarding pattern is used (it only ever reads an already-stored
 * `stripeConnectedAccountId`), so that choice affects only the
 * not-yet-built onboarding endpoints, never this class.
 *
 * Tenant Payments Phase 2: getOrCreateConnectedAccount/createOnboardingLink/
 * getConnectionStatus/syncAccountStatusFromStripeAccount below are that
 * onboarding flow's actual implementation — see
 * TenantPaymentsController for the OWNER-only HTTP surface built on top
 * of them.
 */
@Injectable()
export class TenantPaymentsStripeService {
  private readonly logger = new Logger(TenantPaymentsStripeService.name);
  private cachedConnectWebhookSecret: string | undefined;

  constructor(
    private readonly stripeService: StripeService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Null/undefined (every tenant today, including Trans Atlantic) means
   * "use the platform's own account" — the exact behavior that already
   * existed before TenantPaymentSettings was introduced. `isActive: false`
   * (an admin-suspended connection) falls back the same way rather than
   * failing the checkout outright.
   */
  private async resolveConnectedAccountId(tenantId: string): Promise<string | undefined> {
    const settings = await this.prisma.tenantPaymentSettings.findUnique({ where: { tenantId } });
    if (!settings || !settings.isActive || !settings.stripeConnectedAccountId) return undefined;
    return settings.stripeConnectedAccountId;
  }

  /**
   * Tenant-customer-payment counterpart to StripeService.createCheckoutSession
   * — see that method's own doc comment for the line-item/metadata
   * reasoning, unchanged here.
   *
   * Tenant Payments Phase 1: a connected-account Stripe API call can fail
   * in ways a platform-account call structurally cannot — the connected
   * account was deleted, revoked this platform's access, or (today, since
   * no onboarding flow exists yet) a TenantPaymentSettings row simply
   * points at an id Stripe has never heard of. Stripe's own SDK error for
   * that case includes the account id and a masked API key fragment in
   * its `message`; NestJS's default exception handling forwards an
   * unrecognized thrown object's `message`/`statusCode` straight through
   * to the HTTP response, which would leak that detail to the customer
   * mid-checkout. Caught and logged in full server-side, re-thrown as the
   * same generic, safe message createOnlineCheckoutSession's own
   * defensive branch already uses — deliberately not more specific, so a
   * customer-facing error can never reveal whether the failure was "bad
   * account" vs. any other reason.
   */
  async createCheckoutSession(params: {
    tenantId: string;
    amount: number;
    currency: string;
    invoiceId: string;
    invoiceNumber: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    const connectedAccountId = await this.resolveConnectedAccountId(params.tenantId);
    try {
      return await this.stripeService.client.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: params.currency,
                unit_amount: params.amount,
                product_data: { name: `Invoice ${params.invoiceNumber}` },
              },
            },
          ],
          metadata: { invoiceId: params.invoiceId, invoiceNumber: params.invoiceNumber, tenantId: params.tenantId },
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
        },
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
      );
    } catch (err) {
      this.logger.error(
        `Stripe checkout session creation failed for tenant ${params.tenantId}${connectedAccountId ? ` (connected account ${connectedAccountId})` : ' (platform account)'}: ${err}`,
      );
      throw new InternalServerErrorException('Unable to start checkout — please try again');
    }
  }

  /** See StripeService.expireCheckoutSession's own doc comment — same best-effort reasoning, tenant-account-aware. */
  async expireCheckoutSession(sessionId: string, tenantId: string): Promise<void> {
    try {
      const connectedAccountId = await this.resolveConnectedAccountId(tenantId);
      await this.stripeService.client.checkout.sessions.expire(
        sessionId,
        {},
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
      );
    } catch (err) {
      this.logger.warn(`Could not expire Stripe session ${sessionId} (likely already completed/expired): ${err}`);
    }
  }

  /**
   * Verifies a webhook payload arriving from a Stripe *connected* account
   * (i.e. a tenant's own Connect account, once any tenant has one) against
   * a separate STRIPE_CONNECT_WEBHOOK_SECRET — deliberately never the
   * platform's own PLATFORM_STRIPE_WEBHOOK_SECRET, since Stripe issues a distinct
   * signing secret per registered webhook endpoint. Read lazily (same
   * pattern as ResendEmailProvider/AiAgentService's own API keys) so an
   * environment with no tenant ever connected — every environment today —
   * is completely unaffected by this var being unset; it only becomes
   * required the moment this endpoint actually receives a request.
   */
  constructConnectWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.cachedConnectWebhookSecret) {
      const secret = this.config.get<string>('STRIPE_CONNECT_WEBHOOK_SECRET');
      if (!secret) {
        throw new InternalServerErrorException('Missing required env var "STRIPE_CONNECT_WEBHOOK_SECRET" for connected-account webhooks');
      }
      this.cachedConnectWebhookSecret = secret;
    }
    return this.stripeService.client.webhooks.constructEvent(rawBody, signature, this.cachedConnectWebhookSecret);
  }

  /**
   * Maps a Stripe Connect account id back to the tenant it belongs to (and
   * that tenant's current readiness) — the counterpart lookup to
   * resolveConnectedAccountId above. Used by both the payment webhook
   * (Phase 1, tenant attribution) and the account-status webhook
   * (Phase 2, below). Deliberately no isActive filter on the lookup
   * itself — an inactive account must still resolve to its real tenant so
   * a caller can make an informed, tenant-correct decision (e.g. Phase 2's
   * "don't auto-complete a payment for a not-yet-ready account" rule),
   * rather than being indistinguishable from a genuinely unknown account.
   */
  async findTenantPaymentSettingsByConnectedAccountId(connectedAccountId: string): Promise<{ tenantId: string; isActive: boolean } | null> {
    const settings = await this.prisma.tenantPaymentSettings.findUnique({ where: { stripeConnectedAccountId: connectedAccountId } });
    return settings ? { tenantId: settings.tenantId, isActive: settings.isActive } : null;
  }

  /**
   * Tenant Payments Phase 2: onboarding step 1 — returns the tenant's
   * existing connected account id if one is already on file (resuming
   * incomplete onboarding must never create a second account for the same
   * tenant), or creates a new Express account and stores it, `isActive:
   * false` until the first `account.updated` webhook confirms real
   * readiness (see syncAccountStatusFromStripeAccount below and
   * TenantPaymentSettings's own schema doc comment — existence of an id
   * is never treated as readiness). `card_payments`+`transfers` are
   * requested explicitly: an Express account with neither capability
   * requested can't actually process a charge or receive the resulting
   * payout, which would make "connected" misleading on its own.
   */
  async getOrCreateConnectedAccount(tenantId: string): Promise<string> {
    const existing = await this.prisma.tenantPaymentSettings.findUnique({ where: { tenantId } });
    if (existing?.stripeConnectedAccountId) {
      return existing.stripeConnectedAccountId;
    }

    const account = await this.stripeService.client.accounts.create({
      type: 'express',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    await this.prisma.tenantPaymentSettings.upsert({
      where: { tenantId },
      create: { tenantId, stripeConnectedAccountId: account.id, isActive: false },
      update: { stripeConnectedAccountId: account.id, isActive: false },
    });

    return account.id;
  }

  /**
   * Tenant Payments Phase 2: onboarding step 2 — a fresh, single-use
   * Stripe-hosted onboarding URL for the given (already
   * created/resolved — see getOrCreateConnectedAccount) account.
   * `refreshUrl`/`returnUrl` are always caller-constructed from the
   * tenant's own resolved web-app URL (TenantPaymentsController never
   * accepts either as client input) — an Account Link's redirect targets
   * must never be influenced by request data, the same "no client-
   * suppliable redirect" posture every other tenant-branded link in this
   * codebase already follows. Same safe-error posture as
   * createCheckoutSession above: an Account Link request naming an
   * account Stripe doesn't recognize (or no longer trusts this platform
   * for) fails the same way a bad connected-account checkout does, and
   * must not leak that detail to whoever is mid-onboarding.
   */
  async createOnboardingLink(params: { accountId: string; refreshUrl: string; returnUrl: string }): Promise<string> {
    try {
      const link = await this.stripeService.client.accountLinks.create({
        account: params.accountId,
        refresh_url: params.refreshUrl,
        return_url: params.returnUrl,
        type: 'account_onboarding',
      });
      return link.url;
    } catch (err) {
      this.logger.error(`Stripe Account Link creation failed for connected account ${params.accountId}: ${err}`);
      throw new InternalServerErrorException('Unable to start Stripe onboarding — please try again');
    }
  }

  /** Tenant Payments Phase 2: pure DB read for GET /tenant-payments/connect/status — never calls Stripe's API itself; account.updated (see syncAccountStatusFromStripeAccount) is what keeps isActive current. */
  async getConnectionStatus(tenantId: string): Promise<{ connected: boolean; isActive: boolean }> {
    const settings = await this.prisma.tenantPaymentSettings.findUnique({ where: { tenantId } });
    return { connected: !!settings?.stripeConnectedAccountId, isActive: !!settings?.isActive };
  }

  /**
   * Tenant Payments Phase 2: applies an `account.updated` event to the
   * matching tenant's row. Readiness is `charges_enabled && payouts_enabled`
   * — Stripe's own documented pair for "this account can actually process
   * a charge and receive the resulting payout," deliberately not just
   * `details_submitted` (an account can have submitted onboarding details
   * and still be pending verification/restricted). Returns null — not an
   * error — for an account id with no matching row (deleted/never-synced
   * row racing a webhook, or, in a test/dev environment, a Stripe test
   * account this platform simply doesn't track) so the caller can log and
   * safely ignore it, the same "unknown connected account" posture the
   * payment webhook already establishes.
   */
  async syncAccountStatusFromStripeAccount(account: Stripe.Account): Promise<{ tenantId: string; isActive: boolean } | null> {
    const isActive = !!account.charges_enabled && !!account.payouts_enabled;
    try {
      const updated = await this.prisma.tenantPaymentSettings.update({
        where: { stripeConnectedAccountId: account.id },
        data: { isActive },
      });
      return { tenantId: updated.tenantId, isActive: updated.isActive };
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2025') {
        return null;
      }
      throw err;
    }
  }
}
