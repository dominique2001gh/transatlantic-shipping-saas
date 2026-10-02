import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import type { AuthenticatedUser, MfaSetupResponse, MfaStatusResponse } from '@transatlantic/shared';
import { STAFF_ADMIN_ROLES, STAFF_ROLES, UserRole } from '@transatlantic/shared';
import { AuthService } from '../auth/auth.service';
import { MfaService } from '../auth/mfa/mfa.service';
import { ReplaceFactorStartDto } from '../auth/mfa/dto/replace-factor-start.dto';
import { ReplaceFactorVerifyDto } from '../auth/mfa/dto/replace-factor-verify.dto';
import { AnyAuthenticatedRole } from '../common/decorators/any-authenticated-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { InviteStaffDto } from '../staff-invitations/dto/invite-staff.dto';
import { StaffInvitationsService } from '../staff-invitations/staff-invitations.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateStaffRoleDto } from './dto/update-staff-role.dto';
import { UpdateStaffStatusDto } from './dto/update-staff-status.dto';
import { UsersService } from './users.service';

/**
 * RBAC V1: staff *administration* — invite, change role, deactivate/
 * reactivate, promote to OWNER — is OWNER only (STAFF_ADMIN_ROLES).
 * Deliberately narrower than STAFF_ROLES (which just gates viewing the
 * staff list, below) — MANAGER's "staff oversight" is explicitly
 * view-only per the approved V1 role definitions; none of the actions in
 * this section are reachable by MANAGER, by explicit product decision.
 */

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
    private readonly staffInvitationsService: StaffInvitationsService,
  ) {}

  /** Returns the profile of whoever the access token belongs to — every role, including CUSTOMER. */
  @Get('me')
  @AnyAuthenticatedRole()
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /**
   * Stage 3I: self-service password change — any authenticated role,
   * always the caller's own account (`user.id` from the verified JWT,
   * never a request param/body). See AuthService.changePassword for the
   * current-password verification + bcrypt rehash; the response here
   * never includes a password hash or any other User field.
   */
  @Patch('me/password')
  @AnyAuthenticatedRole()
  async changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto): Promise<{ success: true }> {
    await this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
    return { success: true };
  }

  /**
   * Platform-wide staff MFA (2026-10): self-service factor management for
   * an already-enrolled, already-authenticated staff account — distinct
   * from MfaController's pre-session setup/challenge routes (reached via
   * a stage token before a real session exists). Scoped to STAFF_ROLES,
   * not @AnyAuthenticatedRole() — MFA has no meaning for a CUSTOMER
   * account under the current policy, so this surface is staff-only, the
   * same boundary CustomerPortalController's own doc comment establishes
   * in the other direction.
   */
  @Get('me/mfa/status')
  @Roles(...STAFF_ROLES)
  mfaStatus(@CurrentUser() user: AuthenticatedUser): Promise<MfaStatusResponse> {
    return this.mfaService.status(user.id);
  }

  /** Factor replacement, step 1 — requires the caller's current password; see MfaService.beginFactorReplace. */
  @Post('me/mfa/replace')
  @Roles(...STAFF_ROLES)
  replaceFactor(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReplaceFactorStartDto): Promise<MfaSetupResponse & { replaceToken: string }> {
    return this.mfaService.beginFactorReplace(user.id, dto.currentPassword);
  }

  /** Factor replacement, step 2 — only now does the new factor become active; see MfaService.completeFactorReplace. */
  @Post('me/mfa/replace/verify')
  @HttpCode(HttpStatus.OK)
  @Roles(...STAFF_ROLES)
  replaceFactorVerify(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReplaceFactorVerifyDto): Promise<{ recoveryCodes: string[] }> {
    return this.mfaService.completeFactorReplace(user.id, dto.replaceToken, dto.code);
  }

  /**
   * Lists staff for the caller's own tenant. Demonstrates the required
   * tenant-scoping pattern: tenantId always comes from the JWT, never
   * from the request.
   */
  @Get('staff')
  @Roles(...STAFF_ROLES)
  async listStaff(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) {
      throw new ForbiddenException('No tenant context for this account');
    }
    return this.usersService.findStaffForTenant(user.tenantId);
  }

  /**
   * Staff Invitations stage: the owner enters name+email+role here; the
   * invited employee is the only one who ever sets a password (see
   * AuthController.acceptInvite). Never creates a User directly.
   */
  @Post('invite')
  @Roles(...STAFF_ADMIN_ROLES)
  inviteStaff(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteStaffDto) {
    return this.staffInvitationsService.invite(requireTenantId(user.tenantId), user.id, `${user.firstName} ${user.lastName}`, dto);
  }

  @Get('invitations')
  @Roles(...STAFF_ADMIN_ROLES)
  listInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.staffInvitationsService.listForTenant(requireTenantId(user.tenantId));
  }

  /** Regenerates the token on the same invitation row — the previous emailed link stops working immediately. */
  @Post('invitations/:id/resend')
  @Roles(...STAFF_ADMIN_ROLES)
  resendInvitation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.staffInvitationsService.resend(requireTenantId(user.tenantId), id, `${user.firstName} ${user.lastName}`);
  }

  /**
   * RBAC V1: change an existing staff member's tier. Tenant-scoped lookup
   * (404 on a cross-tenant id, same as every other module) — UsersService
   * additionally rejects a change that would leave the tenant with zero
   * active OWNERs ("OWNER must not accidentally be lockable out of their
   * own tenant"). Works on the caller's own account too, so a tenant with
   * two OWNERs can freely have one demote itself.
   */
  @Patch(':id/role')
  @Roles(...STAFF_ADMIN_ROLES)
  updateRole(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStaffRoleDto) {
    return this.usersService.updateRole(requireTenantId(user.tenantId), id, dto.role);
  }

  /**
   * RBAC V1: deactivate/reactivate a staff member. Same tenant-scoping and
   * last-active-OWNER protection as updateRole above — deactivating a
   * tenant's last active OWNER is rejected the same way demoting one is.
   */
  @Patch(':id/status')
  @Roles(...STAFF_ADMIN_ROLES)
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStaffStatusDto) {
    return this.usersService.setActiveStatus(requireTenantId(user.tenantId), id, dto.isActive);
  }
}

/**
 * Platform-wide staff MFA (2026-10): the one, sole, break-glass path to
 * clear a user's MFA enrollment when they've lost both their device and
 * every recovery code — PLATFORM_ADMIN only, never a tenant-level role,
 * not even OWNER over their own MANAGER/STAFF/FINANCE (see MfaService.
 * adminResetForRecovery's own doc comment for why: "ordinary staff cannot
 * reset another user's MFA" applies to a tenant owner too, not just
 * regular staff). Every call is written to PlatformAuditLog — see that
 * same method. A separate controller (not a method on UsersController)
 * specifically so its @Roles(PLATFORM_ADMIN) is the controller's only
 * role, impossible to accidentally widen by editing the wrong class-level
 * decorator later; RolesGuard's own PLATFORM_ADMIN-tenantId-null
 * hardening additionally guarantees only a real platform admin account
 * (never a tenant role whose token was somehow mis-tagged) can reach it.
 */
@Controller('platform/users')
export class PlatformUsersController {
  constructor(private readonly mfaService: MfaService) {}

  @Post(':userId/mfa/reset-for-recovery')
  @Roles(UserRole.PLATFORM_ADMIN)
  async resetMfaForRecovery(@CurrentUser() admin: AuthenticatedUser, @Param('userId') userId: string): Promise<{ success: true }> {
    await this.mfaService.adminResetForRecovery(admin.id, userId);
    return { success: true };
  }
}
