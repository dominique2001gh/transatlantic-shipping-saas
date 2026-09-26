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
  /** Accounts v2 compatibility fix: lazily built and cached exactly like cachedConnectWebhookSecret — see handleV2AccountWebhook's own doc comment. */
  private v2NotificationHandler: Stripe.StripeEventNotificationHandler | undefined;

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
   * Tenant Payments Phase 2 (Accounts v2 compatibility fix): returns the
   * tenant's existing connected account id if one is already on file
   * (resuming incomplete onboarding must never create a second account for
   * the same tenant), or creates a new connected account via the Accounts
   * v2 API and stores it, `isActive: false` until a webhook confirms real
   * readiness (see syncAccountStatusFromStripeAccountV2 below and
   * TenantPaymentSettings's own schema doc comment — existence of an id is
   * never treated as readiness).
   *
   * Originally used the legacy Accounts v1 `stripe.accounts.create({ type:
   * 'express', ... })` shape. Production's first real Stripe Connect
   * acceptance test (2026-09) was rejected by Stripe: "You tried to create
   * an Accounts v1 connected account using the legacy `type` field with
   * your platform as the losses collector. Use Accounts v2, remove `type`,
   * and set `losses_collector` to `stripe`" — Stripe's platform-level
   * Connect settings now require the v2 shape. Verified against Stripe's
   * own current docs (docs.stripe.com/connect/accounts-v2,
   * docs.stripe.com/connect/risk-management/connected-accounts-with-managed-risk)
   * and this app's actually-installed `stripe` SDK version (22.6.1, whose
   * pinned default API version, confirmed via its own `apiVersion.js`, is
   * `2026-08-26.dahlia` — a stable, non-preview version).
   *
   * `dashboard: 'full'` (not `'express'`) is deliberate: Ananse Logix's
   * architecture — each tenant runs its own independent logistics
   * business and owns its own customer relationship, tenant is merchant of
   * record on direct charges — is exactly Stripe's documented "SaaS
   * platform with payments" pattern, whose recommended mapping is
   * `dashboard: full, fees_collector: stripe, losses_collector: stripe,
   * charge pattern: Direct`. `dashboard: 'express'` combined with
   * `losses_collector: 'stripe'` (Managed Risk) is still in Stripe's
   * public preview and requires opting into a preview API version — not
   * appropriate for this production integration, and unnecessary here
   * since `full` already satisfies the intended architecture on the
   * stable API version already configured.
   *
   * `configuration.merchant.capabilities.card_payments` (not the v1
   * `capabilities.transfers`) is requested: `transfers` was a marketplace/
   * recipient-account capability (platform-initiated fund movement to the
   * connected account) that never matched this direct-charges/merchant
   * architecture in the first place — under Direct charges Stripe pays the
   * connected account directly via its own payouts, so no platform-
   * initiated transfer capability is needed.
   *
   * `identity.country` is hardcoded to `'US'` for the same documented
   * reason `NotificationsService`'s SMS dispatch hardcodes `'US'` for
   * `Customer.phone` normalization: every tenant in this MVP is US-based,
   * and `Tenant.country` is free text ("United States"), not an ISO
   * 3166-1 alpha-2 code Stripe's API requires — revisit if/when a non-US
   * tenant needs to connect their own account.
   */
  async getOrCreateConnectedAccount(tenantId: string, contactEmail: string): Promise<string> {
    const existing = await this.prisma.tenantPaymentSettings.findUnique({ where: { tenantId } });
    if (existing?.stripeConnectedAccountId) {
      return existing.stripeConnectedAccountId;
    }

    const account = await this.stripeService.client.v2.core.accounts.create({
      contact_email: contactEmail,
      dashboard: 'full',
      identity: { country: 'US', entity_type: 'company' },
      configuration: {
        merchant: {
          capabilities: { card_payments: { requested: true } },
        },
      },
      defaults: {
        responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
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

  /** Tenant Payments Phase 2: pure DB read for GET /tenant-payments/connect/status — never calls Stripe's API itself; a webhook (see syncAccountStatusFromStripeAccount for a legacy v1-created account, or syncAccountStatusFromStripeAccountV2 for the current v2 flow) is what keeps isActive current. */
  async getConnectionStatus(tenantId: string): Promise<{ connected: boolean; isActive: boolean }> {
    const settings = await this.prisma.tenantPaymentSettings.findUnique({ where: { tenantId } });
    return { connected: !!settings?.stripeConnectedAccountId, isActive: !!settings?.isActive };
  }

  /**
   * Legacy Accounts v1 path: applies a classic `account.updated` event to
   * the matching tenant's row. Readiness is `charges_enabled &&
   * payouts_enabled` — Stripe's own documented pair for "this account can
   * actually process a charge and receive the resulting payout,"
   * deliberately not just `details_submitted` (an account can have
   * submitted onboarding details and still be pending verification/
   * restricted). Returns null — not an error — for an account id with no
   * matching row (deleted/never-synced row racing a webhook, or, in a
   * test/dev environment, a Stripe test account this platform simply
   * doesn't track) so the caller can log and safely ignore it, the same
   * "unknown connected account" posture the payment webhook already
   * establishes.
   *
   * Accounts v2 compatibility fix (2026-09): getOrCreateConnectedAccount
   * no longer creates v1-shaped accounts, so no *new* connected account
   * will ever emit the classic `account.updated` event this method
   * expects (confirmed empirically — see syncAccountStatusFromStripeAccountV2's
   * own doc comment). Left in place, unmodified, rather than removed:
   * zero connected accounts exist in production today (verified before
   * this fix shipped), so nothing currently depends on it, but removing a
   * working, still-registered webhook handler is not "minimum scope" for
   * this fix — it costs nothing to keep dormant.
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

  /**
   * Accounts v2 compatibility fix (2026-09): the authoritative readiness
   * path for every connected account going forward (getOrCreateConnectedAccount
   * only creates v2 accounts now). Confirmed empirically, in Stripe test
   * mode, before writing this: a v2-created account never fires the
   * classic `account.updated` event syncAccountStatusFromStripeAccount
   * expects — it fires v2-namespaced events instead
   * (`v2.core.account.created`,
   * `v2.core.account[configuration.merchant].capability_status_updated`,
   * `v2.core.account[configuration.merchant].updated`,
   * `v2.core.account[defaults].updated`,
   * `v2.core.account[identity].updated`). This method is driven by the
   * capability-status one — see handleV2AccountWebhook below — which only
   * tells the caller *which* capability changed, not its new value, so
   * this re-fetches the account with `configuration.merchant` included to
   * read the actual current status.
   *
   * Readiness is `configuration.merchant.capabilities.card_payments.status
   * === 'active'` — Stripe's own documented v2 replacement for the legacy
   * `charges_enabled`/`payouts_enabled` pair (those v1 fields still exist
   * on a v2 account's v1-compat view, but Stripe's current guidance is to
   * read the v2 capability status directly rather than continue relying
   * on the deprecated fields). `pending`/`restricted`/`unsupported` all
   * resolve to `isActive: false` — the same "existence of an id is never
   * treated as readiness" posture getOrCreateConnectedAccount's own doc
   * comment establishes; only `active` means the account can really
   * process a charge.
   *
   * Same "unknown account id — log and safely ignore" posture as the v1
   * method: returns null rather than throwing when no matching
   * TenantPaymentSettings row exists.
   */
  async syncAccountStatusFromStripeAccountV2(accountId: string): Promise<{ tenantId: string; isActive: boolean } | null> {
    const account = await this.stripeService.client.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.merchant'],
    });
    const isActive = isCardPaymentsActiveV2(account);
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

  /**
   * Accounts v2 compatibility fix (2026-09): verifies and dispatches an
   * Accounts v2 thin-event webhook delivery, using the Stripe Node SDK's
   * own `notificationHandler` (the officially supported mechanism for v2
   * thin events — a fundamentally different delivery/payload/signature
   * model from the classic v1 snapshot events `StripeService.constructWebhookEvent`
   * and this class's own `constructConnectWebhookEvent` handle; see
   * WebhooksController's own doc comment on the new `/webhooks/stripe-connect-v2`
   * route for why this is a separate route rather than layered onto the
   * existing one).
   *
   * Registers exactly one event type — `v2.core.account[configuration.merchant]
   * .capability_status_updated` — the minimum needed to keep
   * TenantPaymentSettings.isActive correct, per this fix's approved scope.
   * Every other v2 event this platform's connected accounts will emit
   * (account.created, [defaults].updated, [identity].updated, the broader
   * [configuration.merchant].updated) is left unhandled and falls through
   * to the no-op fallback below — Stripe's SDK acks unhandled-but-known
   * event types the same way this codebase's v1 webhook already
   * acknowledges-and-ignores event types it doesn't act on.
   *
   * Deliberately not wired into StripeWebhookLedgerService the way the v1
   * webhooks are: those need it to prevent a retried delivery from
   * double-applying a side effect (e.g. completing a payment twice). A
   * repeated capability_status_updated delivery just re-fetches and
   * re-writes the account's current status — idempotent by construction,
   * not by a separate ledger.
   *
   * `STRIPE_CONNECT_V2_WEBHOOK_SECRET` is read lazily and cached exactly
   * like `constructConnectWebhookEvent`'s own `STRIPE_CONNECT_WEBHOOK_SECRET`
   * — unset in every environment until a v2 Event Destination is actually
   * registered in Stripe's dashboard (see this fix's own report for the
   * exact manual step required), so this route safely never fires until
   * that happens, the same "dormant until configured" posture the v1
   * Connect webhook route originally shipped with.
   */
  async handleV2AccountWebhook(rawBody: Buffer, signature: string): Promise<void> {
    if (!this.v2NotificationHandler) {
      const secret = this.config.get<string>('STRIPE_CONNECT_V2_WEBHOOK_SECRET');
      if (!secret) {
        throw new InternalServerErrorException('Missing required env var "STRIPE_CONNECT_V2_WEBHOOK_SECRET" for Accounts v2 connected-account webhooks');
      }
      const handler = this.stripeService.client.notificationHandler(secret, async () => {
        // Unhandled-but-known (or entirely unknown) v2 event type — acked, not acted on.
      });
      handler.on('v2.core.account[configuration.merchant].capability_status_updated', async (event) => {
        const accountId = event.related_object?.id;
        if (!accountId) return;
        const result = await this.syncAccountStatusFromStripeAccountV2(accountId);
        if (!result) {
          this.logger.warn(`Accounts v2 capability_status_updated for unrecognized account ${accountId} — ignoring`);
        } else {
          this.logger.log(`Synced connected account ${accountId} for tenant ${result.tenantId}: isActive=${result.isActive}`);
        }
      });
      this.v2NotificationHandler = handler;
    }
    await this.v2NotificationHandler.handle(rawBody, signature);
  }
}

/**
 * Narrow structural shape covering only the fields isCardPaymentsActiveV2
 * actually reads — deliberately not `Stripe.V2.Core.Account` itself, whose
 * full `Configuration`/`Merchant`/`Capabilities.CardPayments` types require
 * many more fields (`status_details`, `applied`, etc.) that are irrelevant
 * to this one readiness check and would otherwise force every test/call
 * site to fabricate a complete, real-shaped Stripe object just to set one
 * field three levels deep.
 */
export interface AccountCardPaymentsStatusShape {
  configuration?: {
    merchant?: {
      capabilities?: {
        card_payments?: {
          status?: Stripe.V2.Core.Account.Configuration.Merchant.Capabilities.CardPayments.Status;
        };
      };
    };
  };
}

/**
 * Accounts v2 compatibility fix (2026-09): the authoritative v2 readiness
 * check, extracted as a pure function so it's directly testable without a
 * live Stripe call or a database — see syncAccountStatusFromStripeAccountV2's
 * own doc comment for why `card_payments.status === 'active'` is the
 * correct replacement for the legacy `charges_enabled && payouts_enabled`
 * pair. Exported for tests only; every real call site goes through
 * syncAccountStatusFromStripeAccountV2 above.
 */
export function isCardPaymentsActiveV2(account: AccountCardPaymentsStatusShape): boolean {
  return account.configuration?.merchant?.capabilities?.card_payments?.status === 'active';
}
