import { Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import type { SaasAnalyticsResponse } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AnanseLogix Phase 2 (Section 23): platform-wide SaaS funnel/usage
 * visibility for the founder/platform-admin — website visits and pricing-
 * page views are deliberately NOT tracked here (Section 23's own
 * instruction: "do not introduce invasive tracking without appropriate
 * configuration and consent considerations", and no consent/cookie
 * infrastructure exists in this app). Everything below is derived purely
 * from server-side records that already exist for a real operational
 * reason (SignupSession/PlatformLead/Tenant/TenantSubscription) — no new
 * tracking model, no client-side instrumentation.
 */
@Injectable()
export class SaasAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<SaasAnalyticsResponse> {
    const [
      signupStarts,
      checkoutStarts,
      signupCompletions,
      demoRequests,
      activeTenants,
      trialingTenants,
      pastDueTenants,
      suspendedTenants,
      canceledTenants,
      planGroups,
    ] = await Promise.all([
      this.prisma.signupSession.count(),
      this.prisma.signupSession.count({ where: { stripeCheckoutSessionId: { not: null } } }),
      this.prisma.signupSession.count({ where: { status: 'COMPLETED' } }),
      this.prisma.platformLead.count(),
      this.prisma.tenantSubscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.tenantSubscription.count({ where: { status: SubscriptionStatus.TRIALING } }),
      this.prisma.tenantSubscription.count({ where: { status: SubscriptionStatus.PAST_DUE } }),
      this.prisma.tenantSubscription.count({ where: { status: SubscriptionStatus.SUSPENDED } }),
      this.prisma.tenantSubscription.count({ where: { status: SubscriptionStatus.CANCELED } }),
      this.prisma.tenantSubscription.groupBy({ by: ['planId'], _count: { _all: true } }),
    ]);

    const planIds = planGroups.map((g) => g.planId);
    const plans = await this.prisma.saasPlan.findMany({ where: { id: { in: planIds } } });
    const planById = new Map(plans.map((p) => [p.id, p]));

    return {
      signupStarts,
      checkoutStarts,
      signupCompletions,
      demoRequests,
      activeTenants,
      trialingTenants,
      pastDueTenants,
      suspendedTenants,
      canceledTenants,
      planDistribution: planGroups.map((group) => {
        const plan = planById.get(group.planId);
        return {
          planKey: (plan?.key ?? 'WEBSITE_ONLY') as unknown as SaasAnalyticsResponse['planDistribution'][number]['planKey'],
          planName: plan?.name ?? 'Unknown plan',
          tenantCount: group._count._all,
        };
      }),
    };
  }
}
