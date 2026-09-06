import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnboardingStep } from '@prisma/client';
import type { TenantOnboardingSummary } from '@transatlantic/shared';
import { generateToken } from '../common/token/token.util';
import { staffInvitationEmail } from '../notifications/templates/platform-emails';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.types';
import type { EmailProvider } from '../notifications/providers/provider.types';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BillingPortalDto } from './dto/billing-portal.dto';
import { InviteStaffDto } from './dto/invite-staff.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';
import { UpdateOperationsDto } from './dto/update-operations.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';

const INVITATION_TTL_DAYS = 7;

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
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async getOverview(tenantId: string) {
    const [tenant, onboarding, warehouses, invitations, subscription] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.requireOnboarding(tenantId),
      this.prisma.warehouse.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.tenantInvitation.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
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
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        expiresAt: i.expiresAt.toISOString(),
        createdAt: i.createdAt.toISOString(),
      })),
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
   * Creates a TenantInvitation and best-effort emails it — accepting one
   * (a separate, later endpoint outside onboarding's own scope, reusing
   * the existing account-creation path) is what actually creates the
   * User row; this never creates a User directly.
   */
  async inviteStaff(tenantId: string, invitedByUserId: string, invitedByName: string, dto: InviteStaffDto) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const invitation = await this.prisma.tenantInvitation.create({
      data: {
        tenantId,
        email: dto.email.toLowerCase().trim(),
        role: dto.role,
        token: generateToken(),
        invitedByUserId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    try {
      const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
      const email = staffInvitationEmail({
        inviteeEmail: invitation.email,
        tenantName: tenant.name,
        inviterName: invitedByName,
        acceptUrl: `${webAppUrl.replace(/\/$/, '')}/accept-invite?token=${invitation.token}`,
        expiresAt: invitation.expiresAt,
      });
      await this.emailProvider.send({ to: invitation.email, subject: email.subject, body: email.body });
    } catch (err) {
      this.logger.error(`Failed to send staff invitation email for tenant ${tenantId}: ${err}`);
    }

    const onboarding = await this.requireOnboarding(tenantId);
    if (!onboarding.staffInvitedAt) {
      await this.prisma.tenantOnboarding.update({ where: { tenantId }, data: { staffInvitedAt: new Date() } });
    }

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
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
    const session = await this.stripeService.createBillingPortalSession(subscription.stripeCustomerId, dto.returnUrl);
    return { url: session.url };
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
