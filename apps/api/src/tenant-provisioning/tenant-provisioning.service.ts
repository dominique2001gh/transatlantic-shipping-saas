import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SaasPlanType, SetupFeeStatus, SubscriptionStatus, UserRole } from '@prisma/client';
import type { SignupCompanyDetails } from '@transatlantic/shared';
import type Stripe from 'stripe';
import { slugify } from '../common/slug/slugify.util';
import { signupCompleteEmail, tenantActivatedEmail } from '../notifications/templates/platform-emails';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.types';
import type { EmailProvider } from '../notifications/providers/provider.types';
import { PrismaService } from '../prisma/prisma.service';
import { defaultEntitlementRows } from './plan-entitlements';

/** Maps a Stripe subscription status to our own narrower enum — SUSPENDED is never a Stripe status, only reached by our own grace-period/trial-expiry logic (see SubscriptionsService/SubscriptionStatusGuard). */
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

type SignupSessionForProvisioning = Prisma.SignupSessionGetPayload<{ include: { plan: true } }>;

/**
 * AnanseLogix Phase 1 / Free Trial stage: the single chokepoint that turns
 * a staged SignupSession into a real, usable Tenant — Tenant + TenantSettings
 * + owner User + TenantSubscription + default TenantEntitlement rows +
 * TenantOnboarding, all in one transaction. Two ways in:
 *
 *  - `provisionFromSignupSession` — triggered from the Stripe webhook
 *    (SubscriptionsService.handleCheckoutCompleted) once a real, paid
 *    Checkout Session completes. Used for any plan whose active price has
 *    no trial (trialDays === 0).
 *  - `provisionTrialFromSignupSession` — called directly and synchronously
 *    from SignupService.createCheckout when the selected plan's active
 *    price has a free trial. No Stripe involvement at all: no Customer, no
 *    Subscription, no Checkout Session, no card ever collected or charged.
 *    The tenant gets full plan entitlements immediately; billing is only
 *    ever set up later via `activateTrialSubscription`.
 *
 * Both share `createTenantCore` (Tenant/User/Entitlements/Onboarding) so
 * the two paths can never drift on what a "real" tenant actually gets.
 *
 * Idempotent under Stripe's at-least-once webhook delivery the same way
 * PaymentsService.completeOnlinePayment is: guarded first by
 * SignupSession.status (an already-COMPLETED session is a no-op returning
 * its prior result) and second, as defense-in-depth against a race between
 * two concurrent deliveries, by TenantSubscription.stripeSubscriptionId's
 * unique constraint — if that insert loses the race, the transaction rolls
 * back cleanly and the caller re-reads the now-COMPLETED session instead.
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async provisionFromSignupSession(
    signupSessionId: string,
    stripeSubscription: Stripe.Subscription,
    billing: { priceId: string | undefined; setupFeeCents: number; isPromoRedemption: boolean },
  ): Promise<{ tenantId: string; tenantSlug: string }> {
    const signupSession = await this.prisma.signupSession.findUnique({
      where: { id: signupSessionId },
      include: { plan: true },
    });
    if (!signupSession) {
      throw new Error(`SignupSession ${signupSessionId} not found — cannot provision`);
    }

    const early = await this.checkAlreadyProvisioned(signupSession);
    if (early) return early;

    const byStripeSub = await this.prisma.tenantSubscription.findUnique({
      where: { stripeSubscriptionId: stripeSubscription.id },
    });
    if (byStripeSub) {
      this.logger.log(`Stripe subscription ${stripeSubscription.id} already provisioned as tenant ${byStripeSub.tenantId} — no-op`);
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: byStripeSub.tenantId } });
      return { tenantId: tenant.id, tenantSlug: tenant.slug };
    }

    this.requireSignupSessionComplete(signupSession);

    // Stripe's current_period_start/end live on the subscription *item*,
    // not the top-level Subscription object, in this API version (each
    // item can in principle have its own billing period) — this signup
    // flow only ever creates a subscription with a single line item, so
    // the first one is authoritative.
    const primaryItem = stripeSubscription.items.data[0];
    const currentPeriodStart = primaryItem ? new Date(primaryItem.current_period_start * 1000) : null;
    const currentPeriodEnd = primaryItem ? new Date(primaryItem.current_period_end * 1000) : null;
    const trialEndsAt = stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await this.createTenantCore(tx, signupSession);

      await tx.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          stripeCustomerId: String(stripeSubscription.customer),
          stripeSubscriptionId: stripeSubscription.id,
          planId: signupSession.planId!,
          priceId: billing.priceId,
          status: mapStripeSubscriptionStatus(stripeSubscription.status),
          currentPeriodStart,
          currentPeriodEnd,
          trialEndsAt,
          setupFeeStatus: billing.setupFeeCents > 0 ? SetupFeeStatus.PAID : SetupFeeStatus.WAIVED,
        },
      });

      await this.maybeCountPromoRedemption(tx, billing);
      await this.markSignupSessionCompleted(tx, signupSession.id, tenant.id);

      return tenant;
    });

    this.logger.log(`Provisioned tenant ${result.id} (${result.slug}) from signup session ${signupSessionId}`);
    await this.sendWelcomeEmail(signupSession, result.id, result.name);
    return { tenantId: result.id, tenantSlug: result.slug };
  }

  /**
   * Free Trial stage: provisions a tenant with zero Stripe involvement —
   * no Customer, no Subscription, no card collected or charged. Called
   * synchronously from SignupService.createCheckout (not from a webhook),
   * so SignupSession.status flips to COMPLETED in the same request; the
   * existing success-page polling (SignupService.getStatus) sees that
   * immediately, no different from the webhook-driven path's eventual
   * consistency.
   */
  async provisionTrialFromSignupSession(signupSessionId: string, trialDays: number): Promise<{ tenantId: string; tenantSlug: string }> {
    const signupSession = await this.prisma.signupSession.findUnique({
      where: { id: signupSessionId },
      include: { plan: true },
    });
    if (!signupSession) {
      throw new Error(`SignupSession ${signupSessionId} not found — cannot provision`);
    }

    const early = await this.checkAlreadyProvisioned(signupSession);
    if (early) return early;

    this.requireSignupSessionComplete(signupSession);

    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await this.createTenantCore(tx, signupSession);

      await tx.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          planId: signupSession.planId!,
          priceId: null,
          status: SubscriptionStatus.TRIALING,
          trialEndsAt,
          setupFeeStatus: SetupFeeStatus.PENDING,
        },
      });

      await this.markSignupSessionCompleted(tx, signupSession.id, tenant.id);

      return tenant;
    });

    this.logger.log(`Provisioned trial tenant ${result.id} (${result.slug}) from signup session ${signupSessionId}, trial ends ${trialEndsAt.toISOString()}`);
    await this.sendWelcomeEmail(signupSession, result.id, result.name);
    return { tenantId: result.id, tenantSlug: result.slug };
  }

  /**
   * Free Trial stage: a trial (or trial-expired) tenant explicitly
   * activating real, paid billing — triggered from the Stripe webhook the
   * exact same way a brand-new signup is (SubscriptionsService.
   * handleCheckoutCompleted branches on which metadata key is present),
   * but this updates the tenant's *existing* TenantSubscription row
   * in place rather than creating a new Tenant. Idempotency-guarded by
   * checking whether a real Stripe subscription id is already attached —
   * a replayed webhook for an already-activated tenant is a safe no-op.
   */
  async activateTrialSubscription(
    tenantId: string,
    stripeSubscription: Stripe.Subscription,
    billing: { priceId: string | undefined; isPromoRedemption: boolean },
  ): Promise<void> {
    const existing = await this.prisma.tenantSubscription.findUnique({ where: { tenantId } });
    if (!existing) {
      this.logger.error(`activateTrialSubscription: no TenantSubscription row for tenant ${tenantId} — cannot activate`);
      return;
    }
    if (existing.stripeSubscriptionId) {
      this.logger.log(`Tenant ${tenantId} already has a real Stripe subscription (${existing.stripeSubscriptionId}) — activation is a no-op`);
      return;
    }

    const byStripeSub = await this.prisma.tenantSubscription.findUnique({ where: { stripeSubscriptionId: stripeSubscription.id } });
    if (byStripeSub) {
      this.logger.log(`Stripe subscription ${stripeSubscription.id} already attached to a tenant — activation is a no-op`);
      return;
    }

    const primaryItem = stripeSubscription.items.data[0];
    const currentPeriodStart = primaryItem ? new Date(primaryItem.current_period_start * 1000) : null;
    const currentPeriodEnd = primaryItem ? new Date(primaryItem.current_period_end * 1000) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.tenantSubscription.update({
        where: { id: existing.id },
        data: {
          stripeCustomerId: String(stripeSubscription.customer),
          stripeSubscriptionId: stripeSubscription.id,
          priceId: billing.priceId,
          status: mapStripeSubscriptionStatus(stripeSubscription.status),
          currentPeriodStart,
          currentPeriodEnd,
          setupFeeStatus: SetupFeeStatus.PAID,
        },
      });
      await this.maybeCountPromoRedemption(tx, billing);
    });

    this.logger.log(`Activated paid billing for tenant ${tenantId} (Stripe subscription ${stripeSubscription.id})`);

    try {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const owner = await this.prisma.user.findFirst({ where: { tenantId, role: UserRole.TENANT_OWNER } });
      if (owner) {
        const email = tenantActivatedEmail({ ownerFirstName: owner.firstName, tenantName: tenant.name });
        await this.emailProvider.send({ to: owner.email, subject: email.subject, body: email.body });
      }
    } catch (err) {
      this.logger.error(`Failed to send activation email for tenant ${tenantId}: ${err}`);
    }
  }

  /** Shared by both provisioning paths — Tenant, owner User, default TenantEntitlement rows, TenantOnboarding. Never touches TenantSubscription; each caller creates that row itself, since the two paths need different data there. */
  private async createTenantCore(tx: Prisma.TransactionClient, signupSession: SignupSessionForProvisioning) {
    if (!signupSession.plan || !signupSession.ownerEmail || !signupSession.ownerPasswordHash) {
      throw new Error(`SignupSession ${signupSession.id} is missing required data — cannot provision`);
    }

    const company = signupSession.companyDetails as unknown as SignupCompanyDetails;
    const slug = await this.generateUniqueSlug(company.tradingName || company.legalName);

    const tenant = await tx.tenant.create({
      data: {
        name: company.tradingName || company.legalName,
        slug,
        legalName: company.legalName,
        email: company.businessEmail || signupSession.ownerEmail,
        phone: company.businessPhone,
        website: company.existingWebsite,
        country: company.country,
        timezone: company.timezone,
        currency: 'usd',
        isActive: true,
        // AnanseLogix Phase 2: carried forward from Step 3 of the signup
        // wizard so a future tenant-branded site (Section 15) has real
        // service-list content from day one, not an empty list the owner
        // has to re-enter in site-config.
        serviceTypes: company.serviceTypes ?? [],
        settings: { create: {} },
      },
    });

    await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: signupSession.ownerEmail.toLowerCase().trim(),
        passwordHash: signupSession.ownerPasswordHash,
        firstName: signupSession.ownerFirstName!,
        lastName: signupSession.ownerLastName!,
        phone: signupSession.ownerPhone,
        role: UserRole.TENANT_OWNER,
        isActive: true,
      },
    });

    await tx.tenantEntitlement.createMany({
      data: defaultEntitlementRows(signupSession.plan.key as SaasPlanType).map((row) => ({
        tenantId: tenant.id,
        feature: row.feature,
        enabled: row.enabled,
      })),
    });

    await tx.tenantOnboarding.create({ data: { tenantId: tenant.id } });

    return tenant;
  }

  /** Returns a result to short-circuit with if this SignupSession (or its resulting tenant) is already provisioned — null if provisioning should proceed. */
  private async checkAlreadyProvisioned(signupSession: { id: string; status: string; resultingTenantId: string | null }): Promise<{ tenantId: string; tenantSlug: string } | null> {
    if (signupSession.status === 'COMPLETED' && signupSession.resultingTenantId) {
      const existing = await this.prisma.tenant.findUnique({ where: { id: signupSession.resultingTenantId } });
      if (existing) {
        this.logger.log(`SignupSession ${signupSession.id} already provisioned as tenant ${existing.id} — no-op`);
        return { tenantId: existing.id, tenantSlug: existing.slug };
      }
    }
    return null;
  }

  private requireSignupSessionComplete(signupSession: { plan: unknown; ownerEmail: string | null; ownerPasswordHash: string | null }): void {
    if (!signupSession.plan || !signupSession.ownerEmail || !signupSession.ownerPasswordHash) {
      throw new Error('SignupSession is missing required data — cannot provision');
    }
  }

  /** Counted inside the same idempotency-guarded transaction as the rest of provisioning/activation — see SaasPlanPrice.promoRedemptionCount's own schema doc comment for why. */
  private async maybeCountPromoRedemption(tx: Prisma.TransactionClient, billing: { priceId: string | undefined; isPromoRedemption: boolean }): Promise<void> {
    if (billing.isPromoRedemption && billing.priceId) {
      await tx.saasPlanPrice.update({
        where: { id: billing.priceId },
        data: { promoRedemptionCount: { increment: 1 } },
      });
    }
  }

  private async markSignupSessionCompleted(tx: Prisma.TransactionClient, signupSessionId: string, tenantId: string): Promise<void> {
    await tx.signupSession.update({
      where: { id: signupSessionId },
      data: { status: 'COMPLETED', resultingTenantId: tenantId },
    });
  }

  /** Best-effort — a failed welcome email must never undo provisioning (same "notification failure never rolls back the business operation" posture NotificationsService's own doc comment states). */
  private async sendWelcomeEmail(signupSession: { ownerFirstName: string | null; ownerEmail: string | null }, tenantId: string, tenantName: string): Promise<void> {
    try {
      const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
      const email = signupCompleteEmail({
        ownerFirstName: signupSession.ownerFirstName!,
        tenantName,
        loginUrl: `${webAppUrl.replace(/\/$/, '')}/login`,
      });
      await this.emailProvider.send({ to: signupSession.ownerEmail!, subject: email.subject, body: email.body });
    } catch (err) {
      this.logger.error(`Failed to send signup-complete email for tenant ${tenantId}: ${err}`);
    }
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'company';
    let candidate = base;
    let attempt = 1;
    // Small, bounded loop — collisions are rare and this only runs once
    // per signup, not on a hot path.
    while (await this.prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } })) {
      attempt += 1;
      candidate = `${base}-${attempt}`;
    }
    return candidate;
  }
}
