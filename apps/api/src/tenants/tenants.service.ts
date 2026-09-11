import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PlatformTenantListItem, TenantSubscriptionSummary } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** PLATFORM_ADMIN only — lists every tenant on the platform. */
  findAll() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /**
   * AnanseLogix Phase 1: PLATFORM_ADMIN-only extended tenant list for
   * /platform/tenants — adds subscription/onboarding status on top of the
   * plain findAll() above (kept untouched so nothing already depending on
   * its exact shape breaks). A tenant with no TenantSubscription row
   * (Trans Atlantic, bootstrapped before this layer existed) reports
   * `subscription: null` and `onboardingStep: null` — the frontend/other
   * callers must treat that as "predates SaaS billing", never as an error.
   */
  async findAllForPlatformOverview(): Promise<PlatformTenantListItem[]> {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        subscription: { include: { plan: true } },
        onboarding: { select: { currentStep: true, completedAt: true } },
      },
    });

    return tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      isActive: tenant.isActive,
      createdAt: tenant.createdAt.toISOString(),
      subscription: tenant.subscription
        ? ({
            tenantId: tenant.id,
            planKey: tenant.subscription.plan.key,
            planName: tenant.subscription.plan.name,
            status: tenant.subscription.status,
            currentPeriodStart: tenant.subscription.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: tenant.subscription.currentPeriodEnd?.toISOString() ?? null,
            trialEndsAt: tenant.subscription.trialEndsAt?.toISOString() ?? null,
            setupFeeStatus: tenant.subscription.setupFeeStatus,
            cancelAtPeriodEnd: tenant.subscription.cancelAtPeriodEnd,
            gracePeriodEndsAt: tenant.subscription.gracePeriodEndsAt?.toISOString() ?? null,
          } as unknown as TenantSubscriptionSummary)
        : null,
      onboardingStep: (tenant.onboarding?.currentStep as unknown as PlatformTenantListItem['onboardingStep']) ?? null,
      onboardingCompleted: !!tenant.onboarding?.completedAt,
    }));
  }

  /**
   * A stronger administrative action than the automatic billing-driven
   * SUSPENDED status (see TenantSubscription.status/gracePeriodEndsAt) —
   * this flips Tenant.isActive itself, which JwtStrategy.validate already
   * rejects at login/every request for (see that file's own tenant-active
   * check), i.e. a FULL lockout including billing management, appropriate
   * for e.g. a ToS/abuse action rather than a missed payment. Reversible
   * via reactivate(). Every call is recorded in PlatformAuditLog.
   */
  async suspend(id: string, platformAdminUserId: string, reason?: string) {
    const tenant = await this.findById(id);
    if (!tenant.isActive) {
      throw new BadRequestException('Tenant is already suspended');
    }
    await this.prisma.$transaction([
      this.prisma.tenant.update({ where: { id }, data: { isActive: false } }),
      this.prisma.platformAuditLog.create({
        data: { platformAdminUserId, action: 'TENANT_SUSPENDED', targetTenantId: id, metadata: reason ? { reason } : undefined },
      }),
    ]);
    return this.findById(id);
  }

  async reactivate(id: string, platformAdminUserId: string) {
    const tenant = await this.findById(id);
    if (tenant.isActive) {
      throw new BadRequestException('Tenant is already active');
    }
    await this.prisma.$transaction([
      this.prisma.tenant.update({ where: { id }, data: { isActive: true } }),
      this.prisma.platformAuditLog.create({
        data: { platformAdminUserId, action: 'TENANT_REACTIVATED', targetTenantId: id },
      }),
    ]);
    return this.findById(id);
  }

  /** PLATFORM_ADMIN only — arbitrary tenant lookup by id. */
  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  /** Used by tenant staff to fetch only their own tenant (GET /tenants/me). */
  /**
   * Free Trial stage: also carries a minimal, non-sensitive subscription
   * summary (status/trialEndsAt/planName only — never Stripe IDs) so the
   * dashboard's persistent trial banner can render for *any* authenticated
   * role (this endpoint is @AnyAuthenticatedRole() + @AllowWhenSuspended())
   * without needing the ONBOARDING_ROLES-gated GET /onboarding at all.
   */
  async findOwnTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    const { subscription, ...rest } = tenant;
    return {
      ...rest,
      subscription: subscription
        ? {
            status: subscription.status,
            trialEndsAt: subscription.trialEndsAt,
            planName: subscription.plan.name,
            setupFeeStatus: subscription.setupFeeStatus,
          }
        : null,
    };
  }

  /**
   * Onboards a new tenant with sane defaults (TenantSettings row using
   * platform-default numbering prefixes, which the tenant can customize
   * later). PLATFORM_ADMIN only.
   */
  create(dto: CreateTenantDto) {
    return this.prisma.tenant.create({
      data: {
        ...dto,
        settings: {
          create: {},
        },
      },
      include: { settings: true },
    });
  }
}
