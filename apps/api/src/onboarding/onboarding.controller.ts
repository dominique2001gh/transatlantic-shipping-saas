import { Body, Controller, Get, Post } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ONBOARDING_ROLES } from '@transatlantic/shared';
import { AllowWhenSuspended } from '../common/decorators/allow-when-suspended.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { InviteStaffDto } from '../staff-invitations/dto/invite-staff.dto';
import { BillingPortalDto } from './dto/billing-portal.dto';
import { StartPaidSubscriptionDto } from './dto/start-paid-subscription.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';
import { UpdateOperationsDto } from './dto/update-operations.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { OnboardingService } from './onboarding.service';

/**
 * AnanseLogix Phase 1: the post-signup onboarding wizard's API — scoped to
 * ONBOARDING_ROLES (OWNER only, see that constant's
 * own doc comment), never PLATFORM_ADMIN — this configures one tenant's
 * own setup, not platform-wide state.
 */
@Controller('onboarding')
@Roles(...ONBOARDING_ROLES)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /** Allowed even for a SUSPENDED tenant — the owner needs this to see their own billing status in the first place. */
  @Get()
  @AllowWhenSuspended()
  getOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.getOverview(requireTenantId(user.tenantId));
  }

  @Post('branding')
  updateBranding(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateBrandingDto) {
    return this.onboardingService.updateBranding(requireTenantId(user.tenantId), dto);
  }

  @Post('operations')
  updateOperations(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOperationsDto) {
    return this.onboardingService.updateOperations(requireTenantId(user.tenantId), dto);
  }

  /**
   * RBAC V1: staff administration (inviting included) is OWNER-only —
   * identical to the class-level ONBOARDING_ROLES gate now, so no
   * method-level override is needed here (kept implicit rather than
   * redundantly re-declared). See UsersController's STAFF_ADMIN_ROLES for
   * the permanent staff-management page's identical rule.
   */
  @Post('staff/invite')
  inviteStaff(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteStaffDto) {
    return this.onboardingService.inviteStaff(requireTenantId(user.tenantId), user.id, `${user.firstName} ${user.lastName}`, dto);
  }

  @Post('staff/complete')
  completeStaffStep(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.completeStaffStep(requireTenantId(user.tenantId));
  }

  @Post('tracking')
  updateTracking(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateTrackingDto) {
    return this.onboardingService.updateTracking(requireTenantId(user.tenantId), dto);
  }

  @Post('notifications')
  updateNotifications(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateNotificationsDto) {
    return this.onboardingService.updateNotifications(requireTenantId(user.tenantId), dto);
  }

  /** Allowed even for a SUSPENDED tenant — this is exactly how they restore access (Section 9: "the owner must retain enough access ... to manage billing and restore the subscription"). */
  @Post('billing/portal-session')
  @AllowWhenSuspended()
  @RequireEntitlement(EntitlementFeature.BILLING)
  createBillingPortalSession(@CurrentUser() user: AuthenticatedUser, @Body() dto: BillingPortalDto) {
    return this.onboardingService.createBillingPortalSession(requireTenantId(user.tenantId), dto);
  }

  /**
   * Free Trial stage: the explicit "Activate Paid Billing" action — the
   * only way a trial's TenantSubscription ever gets a real Stripe
   * relationship. Allowed even for a SUSPENDED (expired-trial) tenant for
   * the same reason billing/portal-session is — this *is* how they
   * restore access.
   */
  @Post('billing/subscribe')
  @AllowWhenSuspended()
  @RequireEntitlement(EntitlementFeature.BILLING)
  startPaidSubscription(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartPaidSubscriptionDto) {
    return this.onboardingService.startPaidSubscription(requireTenantId(user.tenantId), user.email, dto);
  }

  @Post('finish')
  finish(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.finish(requireTenantId(user.tenantId));
  }
}
