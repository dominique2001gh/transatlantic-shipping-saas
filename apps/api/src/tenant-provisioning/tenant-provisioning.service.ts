import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SetupFeeStatus, SubscriptionStatus, UserRole } from '@prisma/client';
import type { SignupCompanyDetails } from '@transatlantic/shared';
import type Stripe from 'stripe';
import { slugify } from '../common/slug/slugify.util';
import { signupCompleteEmail } from '../notifications/templates/platform-emails';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.types';
import type { EmailProvider } from '../notifications/providers/provider.types';
import { PrismaService } from '../prisma/prisma.service';
import { defaultEntitlementRows } from './plan-entitlements';

/** Maps a Stripe subscription status to our own narrower enum — SUSPENDED is never a Stripe status, only reached by our own grace-period expiry logic (see SubscriptionsService). */
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
 * AnanseLogix Phase 1: the single chokepoint that turns a paid-for
 * SignupSession into a real, usable Tenant — Tenant + TenantSettings +
 * owner User + TenantSubscription + default TenantEntitlement rows +
 * TenantOnboarding, all in one transaction. Triggered exclusively from the
 * Stripe webhook (SubscriptionsService.handleCheckoutCompleted), never
 * from the frontend success-page redirect — see SignupSessionStatus's own
 * doc comment for why.
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

    if (signupSession.status === 'COMPLETED' && signupSession.resultingTenantId) {
      const existing = await this.prisma.tenant.findUnique({ where: { id: signupSession.resultingTenantId } });
      if (existing) {
        this.logger.log(`SignupSession ${signupSessionId} already provisioned as tenant ${existing.id} — no-op`);
        return { tenantId: existing.id, tenantSlug: existing.slug };
      }
    }

    const byStripeSub = await this.prisma.tenantSubscription.findUnique({
      where: { stripeSubscriptionId: stripeSubscription.id },
    });
    if (byStripeSub) {
      this.logger.log(`Stripe subscription ${stripeSubscription.id} already provisioned as tenant ${byStripeSub.tenantId} — no-op`);
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: byStripeSub.tenantId } });
      return { tenantId: tenant.id, tenantSlug: tenant.slug };
    }

    if (!signupSession.plan || !signupSession.ownerEmail || !signupSession.ownerPasswordHash) {
      throw new Error(`SignupSession ${signupSessionId} is missing required data — cannot provision`);
    }

    const company = signupSession.companyDetails as unknown as SignupCompanyDetails;
    const slug = await this.generateUniqueSlug(company.tradingName || company.legalName);

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
      const tenant = await tx.tenant.create({
        data: {
          name: company.tradingName || company.legalName,
          slug,
          legalName: company.legalName,
          email: company.businessEmail || signupSession.ownerEmail!,
          phone: company.businessPhone,
          website: company.existingWebsite,
          country: company.country,
          timezone: company.timezone,
          currency: signupSession.plan!.key === 'WEBSITE_ONLY' ? 'usd' : 'usd',
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
          email: signupSession.ownerEmail!.toLowerCase().trim(),
          passwordHash: signupSession.ownerPasswordHash!,
          firstName: signupSession.ownerFirstName!,
          lastName: signupSession.ownerLastName!,
          phone: signupSession.ownerPhone,
          role: UserRole.TENANT_OWNER,
          isActive: true,
        },
      });

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

      // Counted here — inside the same idempotency-guarded transaction as
      // the rest of provisioning — so a replayed webhook can never
      // increment this twice (a replay hits the early-return "already
      // provisioned" checks above and never reaches this transaction at
      // all). See SaasPlanPrice.promoRedemptionCount's own schema doc
      // comment for why this exists.
      if (billing.isPromoRedemption && billing.priceId) {
        await tx.saasPlanPrice.update({
          where: { id: billing.priceId },
          data: { promoRedemptionCount: { increment: 1 } },
        });
      }

      await tx.tenantEntitlement.createMany({
        data: defaultEntitlementRows(signupSession.plan!.key).map((row) => ({
          tenantId: tenant.id,
          feature: row.feature,
          enabled: row.enabled,
        })),
      });

      await tx.tenantOnboarding.create({ data: { tenantId: tenant.id } });

      await tx.signupSession.update({
        where: { id: signupSession.id },
        data: { status: 'COMPLETED', resultingTenantId: tenant.id },
      });

      return tenant;
    });

    this.logger.log(`Provisioned tenant ${result.id} (${result.slug}) from signup session ${signupSessionId}`);

    // Best-effort — a failed welcome email must never undo provisioning
    // (same "notification failure never rolls back the business
    // operation" posture NotificationsService's own doc comment states).
    try {
      const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
      const email = signupCompleteEmail({
        ownerFirstName: signupSession.ownerFirstName!,
        tenantName: result.name,
        loginUrl: `${webAppUrl.replace(/\/$/, '')}/login`,
      });
      await this.emailProvider.send({ to: signupSession.ownerEmail!, subject: email.subject, body: email.body });
    } catch (err) {
      this.logger.error(`Failed to send signup-complete email for tenant ${result.id}: ${err}`);
    }

    return { tenantId: result.id, tenantSlug: result.slug };
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
