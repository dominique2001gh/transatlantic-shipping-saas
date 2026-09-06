import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.types';
import type { EmailProvider } from '../notifications/providers/provider.types';
import { paymentFailureEmail, tenantActivatedEmail } from '../notifications/templates/platform-emails';
import { PrismaService } from '../prisma/prisma.service';
import { effectivePrice } from '../saas-plans/promo-pricing.util';
import { StripeService } from '../stripe/stripe.service';
import { TenantProvisioningService } from '../tenant-provisioning/tenant-provisioning.service';

/**
 * AnanseLogix Phase 1: how many days a PAST_DUE tenant keeps full access
 * before access is restricted to SUSPENDED (billing-only) — see
 * TenantSubscription.gracePeriodEndsAt's own doc comment. A fixed constant
 * for Phase 1, not yet a platform-configurable setting.
 */
export const GRACE_PERIOD_DAYS = 7;

function mapStripeSubscriptionStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':
      return SubscriptionStatus.TRIALING;
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'past_due':
      return SubscriptionStatus.PAST_DUE;
    case 'canceled':
      return SubscriptionStatus.CANCELED;
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
    default:
      return SubscriptionStatus.UNPAID;
  }
}

/**
 * AnanseLogix Phase 1: everything downstream of a Stripe subscription-
 * billing webhook event, called exclusively from WebhooksController after
 * signature verification + the StripeWebhookEvent ledger check — see that
 * controller's own doc comment for why this is split from
 * PaymentsService's existing one-time-invoice-payment handling (different
 * event shapes, different idempotency needs).
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly tenantProvisioningService: TenantProvisioningService,
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * A subscription-mode Checkout Session completed. Resolves back to the
   * SignupSession that staged this signup via `metadata.signupSessionToken`
   * (falling back to stripeCheckoutSessionId, set by SignupService right
   * after creating the session) and hands off to
   * TenantProvisioningService — this method owns nothing about *how* a
   * tenant gets created, only *finding the right SignupSession* and
   * fetching the setup-fee amount actually configured at signup time.
   */
  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    if (!session.subscription) {
      this.logger.warn(`Subscription-mode checkout ${session.id} completed with no subscription id — ignoring`);
      return;
    }

    const token = session.metadata?.signupSessionToken;
    const signupSession = token
      ? await this.prisma.signupSession.findUnique({ where: { token }, include: { plan: { include: { prices: true } } } })
      : await this.prisma.signupSession.findUnique({
          where: { stripeCheckoutSessionId: session.id },
          include: { plan: { include: { prices: true } } },
        });

    if (!signupSession) {
      this.logger.warn(`Checkout session ${session.id} completed but no matching SignupSession was found — ignoring`);
      return;
    }

    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const stripeSubscription = await this.stripeService.retrieveSubscription(subscriptionId);

    // Same effectivePrice() util SaasPlansService/SignupService use — the
    // setup fee actually charged (and whether this counts as a promo
    // redemption) must be computed identically everywhere, never
    // re-derived a second way. Falls back to 0/no-promo if the plan's
    // price was somehow removed between checkout and webhook — provisioning
    // still proceeds rather than losing a paid signup over a display detail.
    const activePrice = signupSession.plan?.prices.find((p) => p.isActive);
    const effective = activePrice ? effectivePrice(activePrice) : { isPromoActive: false, setupFeeCents: 0, monthlyAmountCents: 0 };

    await this.tenantProvisioningService.provisionFromSignupSession(signupSession.id, stripeSubscription, {
      priceId: activePrice?.id,
      setupFeeCents: effective.setupFeeCents,
      isPromoRedemption: effective.isPromoActive,
    });
  }

  /** customer.subscription.updated / customer.subscription.deleted. */
  async handleSubscriptionUpdated(subscription: Stripe.Subscription, eventType: string): Promise<void> {
    const existing = await this.prisma.tenantSubscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    if (!existing) {
      // Most likely arrived before the checkout.session.completed event
      // that provisions the tenant — safe to ignore; the eventual
      // provisioning call reads the subscription fresh from Stripe anyway.
      this.logger.warn(`customer.subscription event for unknown subscription ${subscription.id} — ignoring`);
      return;
    }

    const status = eventType === 'customer.subscription.deleted' ? SubscriptionStatus.CANCELED : mapStripeSubscriptionStatus(subscription.status);
    const primaryItem = subscription.items.data[0];

    await this.prisma.tenantSubscription.update({
      where: { id: existing.id },
      data: {
        status,
        currentPeriodStart: primaryItem ? new Date(primaryItem.current_period_start * 1000) : existing.currentPeriodStart,
        currentPeriodEnd: primaryItem ? new Date(primaryItem.current_period_end * 1000) : existing.currentPeriodEnd,
        trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : existing.trialEndsAt,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        // Recovering to a healthy status clears any pending grace-period clock.
        gracePeriodEndsAt: status === SubscriptionStatus.ACTIVE || status === SubscriptionStatus.TRIALING ? null : existing.gracePeriodEndsAt,
      },
    });
  }

  /** invoice.paid — a recurring (or the first) subscription invoice was successfully collected. */
  async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = this.extractSubscriptionId(invoice);
    if (!subscriptionId) return;

    const existing = await this.prisma.tenantSubscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
    if (!existing) {
      this.logger.warn(`invoice.paid for unknown subscription ${subscriptionId} — ignoring`);
      return;
    }

    const wasRecovering = existing.status === SubscriptionStatus.PAST_DUE || existing.status === SubscriptionStatus.SUSPENDED;

    await this.prisma.tenantSubscription.update({
      where: { id: existing.id },
      data: { status: SubscriptionStatus.ACTIVE, gracePeriodEndsAt: null },
    });

    if (wasRecovering) {
      try {
        const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: existing.tenantId } });
        const owner = await this.prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'TENANT_OWNER' } });
        if (owner) {
          const email = tenantActivatedEmail({ ownerFirstName: owner.firstName, tenantName: tenant.name });
          await this.emailProvider.send({ to: owner.email, subject: email.subject, body: email.body });
        }
      } catch (err) {
        this.logger.error(`Failed to send tenant-activated email for subscription ${subscriptionId}: ${err}`);
      }
    }
  }

  /** invoice.payment_failed — starts (or extends) the grace-period clock. */
  async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = this.extractSubscriptionId(invoice);
    if (!subscriptionId) return;

    const existing = await this.prisma.tenantSubscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
    if (!existing) {
      this.logger.warn(`invoice.payment_failed for unknown subscription ${subscriptionId} — ignoring`);
      return;
    }

    const gracePeriodEndsAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.tenantSubscription.update({
      where: { id: existing.id },
      data: { status: SubscriptionStatus.PAST_DUE, gracePeriodEndsAt },
    });

    try {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: existing.tenantId } });
      const owner = await this.prisma.user.findFirst({ where: { tenantId: tenant.id, role: 'TENANT_OWNER' } });
      if (owner) {
        const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
        const email = paymentFailureEmail({
          ownerFirstName: owner.firstName,
          tenantName: tenant.name,
          gracePeriodEndsAt,
          billingUrl: `${webAppUrl.replace(/\/$/, '')}/onboarding/billing`,
        });
        await this.emailProvider.send({ to: owner.email, subject: email.subject, body: email.body });
      }
    } catch (err) {
      this.logger.error(`Failed to send payment-failure email for subscription ${subscriptionId}: ${err}`);
    }
  }

  /**
   * In this Stripe API version, an Invoice no longer carries a top-level
   * `subscription` field — the link lives at
   * `invoice.parent.subscription_details.subscription` (`parent.type ===
   * 'subscription_details'`). A manual/one-off invoice (unrelated to any
   * subscription — this app's existing invoice-payment feature never
   * produces Stripe Invoice objects at all, only Checkout Sessions, so
   * there's no ambiguity with that flow) has `parent` unset or a
   * different type, in which case this returns null and the caller
   * safely ignores the event.
   */
  private extractSubscriptionId(invoice: Stripe.Invoice): string | null {
    const parent = invoice.parent;
    if (!parent || parent.type !== 'subscription_details' || !parent.subscription_details) {
      return null;
    }
    const raw = parent.subscription_details.subscription;
    if (!raw) return null;
    return typeof raw === 'string' ? raw : raw.id;
  }
}
