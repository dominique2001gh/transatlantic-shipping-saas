import { Body, Controller, Get, Post } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ONBOARDING_ROLES, UserRole } from '@transatlantic/shared';
import { AllowWhenSuspended } from '../common/decorators/allow-when-suspended.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { InviteStaffDto } from '../staff-invitations/dto/invite-staff.dto';
import { BillingPortalDto } from './dto/billing-portal.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';
import { UpdateOperationsDto } from './dto/update-operations.dto';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { OnboardingService } from './onboarding.service';

/**
 * AnanseLogix Phase 1: the post-signup onboarding wizard's API — scoped to
 * ONBOARDING_ROLES (TENANT_OWNER/TENANT_ADMIN only, see that constant's
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
   * Staff Invitations stage: overrides the class-level ONBOARDING_ROLES
   * (TENANT_OWNER/TENANT_ADMIN) for this one route only — inviting staff
   * is scoped to TENANT_OWNER/WAREHOUSE_MANAGER specifically, matching
   * the same rule the permanent staff-management page enforces (see
   * UsersController). Every other onboarding route keeps its original
   * ONBOARDING_ROLES gate, unchanged.
   */
  @Post('staff/invite')
  @Roles(UserRole.TENANT_OWNER, UserRole.WAREHOUSE_MANAGER)
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

  @Post('finish')
  finish(@CurrentUser() user: AuthenticatedUser) {
    return this.onboardingService.finish(requireTenantId(user.tenantId));
  }
}
