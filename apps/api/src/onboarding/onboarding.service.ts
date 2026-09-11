import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnboardingStep } from '@prisma/client';
import type { TenantOnboardingSummary } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { effectivePrice } from '../saas-plans/promo-pricing.util';
import { SaasPlansService } from '../saas-plans/saas-plans.service';
import { InviteStaffDto } from '../staff-invitations/dto/invite-staff.dto';
import { StaffInvitationsService } from '../staff-invitations/staff-invitations.service';
import { StripeService } from '../stripe/stripe.service';
import { BillingPortalDto } from './dto/billing-portal.dto';
import { StartPaidSubscriptionDto } from './dto/start-paid-subscription.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';
import { UpdateOperationsDto } from './dto/update-operations.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';

/**
 * AnanseLogix Phase 1: drives a newly-provisioned tenant through the
 * post-payment onboarding wizard (Section 8 of the build brief) —
 * Branding -> Operations -> Staff -> Tracking -> Notifications -> Billing
 * -> Finish. Every method here is tenant-scoped and reuses existing
 * columns/tables wherever they already exist (Tenant's own branding
 * fields, TenantSettings' numbering prefixes, the existing User creation
 * shape for staff) rather than inventing parallel storage — see each
 * method's own comment for what it actually touches.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly staffInvitationsService: StaffInvitationsService,
    private readonly saasPlansService: SaasPlansService,
  ) {}

  async getOverview(tenantId: string) {
    const [tenant, onboarding, warehouses, invitations, subscription] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.requireOnboarding(tenantId),
      this.prisma.warehouse.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
      this.staffInvitationsService.listForTenant(tenantId),
      this.prisma.tenantSubscription.findUnique({ where: { tenantId }, include: { plan: true } }),
    ]);

    return {
      tenant: {
        name: tenant.name,
        logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
        phone: tenant.phone,
        email: tenant.email,
        whatsappNumber: tenant.whatsappNumber,
      },
      onboarding: this.toSummary(onboarding),
      warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, code: w.code, isOriginWarehouse: w.isOriginWarehouse, isDestinationWarehouse: w.isDestinationWarehouse })),
      invitations,
      subscription: subscription
        ? {
            tenantId,
            planKey: subscription.plan.key,
            planName: subscription.plan.name,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
            trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
            setupFeeStatus: subscription.setupFeeStatus,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            gracePeriodEndsAt: subscription.gracePeriodEndsAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  async updateBranding(tenantId: string, dto: UpdateBrandingDto): Promise<TenantOnboardingSummary> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: dto.displayName,
        logoUrl: dto.logoUrl,
        primaryColor: dto.primaryColor,
        secondaryColor: dto.secondaryColor,
        phone: dto.publicPhone,
        email: dto.publicEmail,
        whatsappNumber: dto.whatsappNumber,
      },
    });
    return this.advanceStep(tenantId, OnboardingStep.BRANDING, OnboardingStep.OPERATIONS, { brandingCompletedAt: new Date() });
  }

  async updateOperations(tenantId: string, dto: UpdateOperationsDto): Promise<TenantOnboardingSummary> {
    if (dto.defaultOriginCountry !== undefined || dto.defaultDestinationCountry !== undefined) {
      await this.prisma.tenantSettings.update({
        where: { tenantId },
        data: {
          defaultOriginCountry: dto.defaultOriginCountry,
          defaultDestinationCountry: dto.defaultDestinationCountry,
        },
      });
    }
    if (dto.warehouses?.length) {
      await this.prisma.warehouse.createMany({
        data: dto.warehouses.map((w) => ({
          tenantId,
          name: w.name,
          code: w.code,
          addressLine1: w.addressLine1,
          city: w.city,
          country: w.country,
          isOriginWarehouse: w.isOriginWarehouse ?? false,
          isDestinationWarehouse: w.isDestinationWarehouse ?? false,
        })),
      });
    }
    return this.advanceStep(tenantId, OnboardingStep.OPERATIONS, OnboardingStep.STAFF, { operationsCompletedAt: new Date() });
  }

  /**
   * Staff Invitations stage: delegates the actual invitation creation to
   * StaffInvitationsService — the same code path the permanent staff-
   * management page uses (see that service's own doc comment) — and
   * layers on this wizard's own onboarding-progress bookkeeping
   * (staffInvitedAt) on top. Never creates a User directly; accepting the
   * invitation is what does that.
   */
  async inviteStaff(tenantId: string, invitedByUserId: string, invitedByName: string, dto: InviteStaffDto) {
    const invitation = await this.staffInvitationsService.invite(tenantId, invitedByUserId, invitedByName, dto);

    const onboarding = await this.requireOnboarding(tenantId);
    if (!onboarding.staffInvitedAt) {
      await this.prisma.tenantOnboarding.update({ where: { tenantId }, data: { staffInvitedAt: new Date() } });
    }

    return invitation;
  }

  /** Advances past the Staff step even with zero invitations sent — inviting staff during onboarding is optional, not mandatory. */
  async completeStaffStep(tenantId: string): Promise<TenantOnboardingSummary> {
    const onboarding = await this.requireOnboarding(tenantId);
    return this.advanceStep(tenantId, OnboardingStep.STAFF, OnboardingStep.TRACKING, {
      staffInvitedAt: onboarding.staffInvitedAt ?? new Date(),
    });
  }

  async updateTracking(tenantId: string, dto: UpdateTrackingDto): Promise<TenantOnboardingSummary> {
    if (dto.trackingNumberPrefix) {
      await this.prisma.tenantSettings.update({
        where: { tenantId },
        data: { trackingNumberPrefix: dto.trackingNumberPrefix },
      });
    }
    return this.advanceStep(tenantId, OnboardingStep.TRACKING, OnboardingStep.NOTIFICATIONS, { trackingCompletedAt: new Date() });
  }

  /** See UpdateNotificationsDto's own doc comment for why this step is intentionally lightweight in Phase 1. */
  async updateNotifications(tenantId: string, _dto: UpdateNotificationsDto): Promise<TenantOnboardingSummary> {
    return this.advanceStep(tenantId, OnboardingStep.NOTIFICATIONS, OnboardingStep.BILLING, { notificationsCompletedAt: new Date() });
  }

  async createBillingPortalSession(tenantId: string, dto: BillingPortalDto): Promise<{ url: string }> {
    const subscription = await this.prisma.tenantSubscription.findUnique({ where: { tenantId } });
    if (!subscription) {
      throw new BadRequestException('No billing account found for this tenant yet');
    }
    // Free Trial stage: a trial tenant has no real Stripe customer yet
    // (see TenantSubscription.stripeCustomerId's own doc comment) — the
    // portal manages an existing Stripe billing relationship, so this
    // must fail clearly rather than call Stripe with a null id. The
    // frontend should show "Activate Paid Billing" (startPaidSubscription
    // below) instead of "Manage Billing" until stripeCustomerId exists.
    if (!subscription.stripeCustomerId) {
      throw new BadRequestException('Activate paid billing before managing it — this tenant is still on a free trial');
    }
    const session = await this.stripeService.createBillingPortalSession(subscription.stripeCustomerId, dto.returnUrl);
    return { url: session.url };
  }

  /**
   * Free Trial stage: the explicit, tenant-initiated action that starts
   * real, paid billing for a trial (or trial-expired) tenant — the first
   * and only time Stripe is ever contacted for such a tenant. Builds a
   * normal, non-trial Checkout Session (full setup fee + recurring price,
   * card required now) for the plan the tenant already selected at
   * signup — never a client-supplied plan/amount. Tagged with
   * `activateTenantId` so SubscriptionsService.handleCheckoutCompleted
   * updates this tenant's existing TenantSubscription row in place
   * instead of creating a new tenant (see that method's own doc comment).
   */
  async startPaidSubscription(tenantId: string, ownerEmail: string, dto: StartPaidSubscriptionDto): Promise<{ url: string }> {
    const subscription = await this.prisma.tenantSubscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!subscription) {
      throw new BadRequestException('No billing account found for this tenant yet');
    }
    if (subscription.stripeSubscriptionId) {
      throw new BadRequestException('Paid billing is already active for this tenant');
    }

    const price = await this.saasPlansService.findActivePriceForPlanKey(subscription.planId);
    if (!price) {
      throw new BadRequestException('This plan does not have active pricing configured yet — please contact us');
    }
    const effective = effectivePrice(price);

    const checkoutSession = await this.stripeService.createSubscriptionCheckoutSession({
      metadata: { activateTenantId: tenantId },
      customerEmail: ownerEmail,
      planName: subscription.plan.name,
      currency: price.currency,
      monthlyAmountCents: effective.monthlyAmountCents,
      setupFeeCents: effective.setupFeeCents,
      trialDays: 0,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
    if (!checkoutSession.url) {
      throw new BadRequestException('Unable to start checkout — please try again');
    }
    return { url: checkoutSession.url };
  }

  async finish(tenantId: string): Promise<TenantOnboardingSummary> {
    const onboarding = await this.prisma.tenantOnboarding.update({
      where: { tenantId },
      data: { currentStep: OnboardingStep.DONE, completedAt: new Date() },
    });
    return this.toSummary(onboarding);
  }

  private async requireOnboarding(tenantId: string) {
    const onboarding = await this.prisma.tenantOnboarding.findUnique({ where: { tenantId } });
    if (!onboarding) {
      throw new NotFoundException('No onboarding record for this tenant');
    }
    return onboarding;
  }

  /**
   * Only advances `currentStep` forward from `fromStep` — calling a step's
   * endpoint again (e.g. editing branding after already moving on) still
   * updates the underlying data but never regresses the wizard's position,
   * and never advances out of order.
   */
  private async advanceStep(
    tenantId: string,
    fromStep: OnboardingStep,
    toStep: OnboardingStep,
    completionFields: Record<string, Date>,
  ): Promise<TenantOnboardingSummary> {
    const onboarding = await this.requireOnboarding(tenantId);
    const updated = await this.prisma.tenantOnboarding.update({
      where: { tenantId },
      data: {
        ...completionFields,
        currentStep: onboarding.currentStep === fromStep ? toStep : onboarding.currentStep,
      },
    });
    return this.toSummary(updated);
  }

  private toSummary(onboarding: {
    currentStep: OnboardingStep;
    brandingCompletedAt: Date | null;
    operationsCompletedAt: Date | null;
    staffInvitedAt: Date | null;
    trackingCompletedAt: Date | null;
    notificationsCompletedAt: Date | null;
    completedAt: Date | null;
  }): TenantOnboardingSummary {
    return {
      currentStep: onboarding.currentStep as unknown as TenantOnboardingSummary['currentStep'],
      brandingCompletedAt: onboarding.brandingCompletedAt?.toISOString() ?? null,
      operationsCompletedAt: onboarding.operationsCompletedAt?.toISOString() ?? null,
      staffInvitedAt: onboarding.staffInvitedAt?.toISOString() ?? null,
      trackingCompletedAt: onboarding.trackingCompletedAt?.toISOString() ?? null,
      notificationsCompletedAt: onboarding.notificationsCompletedAt?.toISOString() ?? null,
      completedAt: onboarding.completedAt?.toISOString() ?? null,
    };
  }
}
