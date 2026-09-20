import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PlatformTenantListItem, TenantSubscriptionSummary } from '@transatlantic/shared';
import { resolveTenantPublicSiteUrl } from '../common/tenant/tenant-web-app-url.util';
import { dropoffLinkEmail } from '../notifications/templates/shipment-customer-emails';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.types';
import type { EmailProvider } from '../notifications/providers/provider.types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

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
   * Quick Receive's "Send Drop-Off Link" card: the customer-facing
   * "Prepare Your Drop-Off" URL for this tenant. Uses
   * resolveTenantPublicSiteUrl — NOT resolveTenantWebAppUrl (that one is
   * for staff-invitation-style links and, for the legacy-slugged tenant,
   * deliberately resolves to the staff hostname) — see that function's own
   * doc comment for exactly why a customer-facing link needs a different
   * legacy resolution. Never hardcodes talogisticssolutions.com: this
   * generalizes to any future tenant the moment it has a real customDomain,
   * with no further code change here.
   */
  async getDropoffLink(tenantId: string): Promise<{ url: string }> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { slug: true, customDomain: true },
    });
    const baseUrl = resolveTenantPublicSiteUrl(tenant, this.config);
    return { url: `${baseUrl.replace(/\/$/, '')}/dropoff` };
  }

  /**
   * Emails the same link above to a customer, branded as this tenant —
   * same "a tenant emailing their own shipping customer" posture as
   * NotificationsService's shipment-lifecycle emails (see
   * shipment-customer-emails.ts's own doc comment), never
   * resolvePlatformEmailSender/AnanseLogix branding, which is for the
   * opposite direction (AnanseLogix-the-platform mailing a tenant about
   * their own account).
   */
  async sendDropoffLinkEmail(tenantId: string, toEmail: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const baseUrl = resolveTenantPublicSiteUrl(tenant, this.config);
    const dropoffUrl = `${baseUrl.replace(/\/$/, '')}/dropoff`;

    const email = dropoffLinkEmail({
      tenant: {
        name: tenant.name,
        legalName: tenant.legalName,
        logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
        email: tenant.email,
        phone: tenant.phone,
        website: tenant.website,
      },
      dropoffUrl,
    });

    const result = await this.emailProvider.send({ to: toEmail, subject: email.subject, body: email.text, html: email.html });
    if (!result.success) {
      throw new BadRequestException(result.errorMessage ?? 'Failed to send the email — try Copy Link instead.');
    }
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
