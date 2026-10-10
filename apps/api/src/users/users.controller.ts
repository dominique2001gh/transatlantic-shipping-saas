import { Body, Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { STAFF_ROLES } from '@transatlantic/shared';
import { AuthService } from '../auth/auth.service';
import { AnyAuthenticatedRole } from '../common/decorators/any-authenticated-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { InviteStaffDto } from '../staff-invitations/dto/invite-staff.dto';
import { StaffInvitationsService } from '../staff-invitations/staff-invitations.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateStaffPermissionsDto } from './dto/update-staff-permissions.dto';
import { UpdateStaffRoleDto } from './dto/update-staff-role.dto';
import { UpdateStaffStatusDto } from './dto/update-staff-status.dto';
import { UsersService } from './users.service';

/**
 * RBAC permissions (2026-10): staff *administration* (invite, change
 * role, deactivate/reactivate, change permissions) is no longer
 * structurally OWNER-only at the role-gate level — it's now STAFF_ROLES
 * (every tenant-staff tier) + @RequirePermission(...), so an OWNER can
 * delegate specific staff-administration capabilities to a non-owner via
 * the permissions system (e.g. an ADMIN-preset MANAGER with
 * staff.manage). This is SAFE for every existing account: the legacy
 * backfill (scripts/backfill-rbac-permissions.ts) deliberately excludes
 * staff.invite/staff.manage/staff.permissions from every pre-existing
 * MANAGER/STAFF/FINANCE account's migrated set, so broadening this role
 * gate changes zero actual access until an OWNER makes an explicit new
 * grant — see PermissionsGuard and UsersService's own additional
 * OWNER-boundary/self-escalation guards for the rest of this surface's
 * protection.
 */

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
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
   * Lists staff for the caller's own tenant. Demonstrates the required
   * tenant-scoping pattern: tenantId always comes from the JWT, never
   * from the request. Deliberately NOT narrowed by @RequirePermission —
   * every tenant-staff tier has always been able to see who else works at
   * the tenant (this is "who are my colleagues," not a staff-management
   * capability); narrowing it now would retroactively lock out existing
   * STAFF/FINANCE accounts the legacy backfill never granted staff.view.
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
  @Roles(...STAFF_ROLES)
  @RequirePermission('staff.invite')
  inviteStaff(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteStaffDto) {
    return this.staffInvitationsService.invite(
      requireTenantId(user.tenantId),
      user.id,
      `${user.firstName} ${user.lastName}`,
      dto,
      user.role,
      user.permissions,
    );
  }

  @Get('invitations')
  @Roles(...STAFF_ROLES)
  @RequirePermission('staff.invite')
  listInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.staffInvitationsService.listForTenant(requireTenantId(user.tenantId));
  }

  /** Regenerates the token on the same invitation row — the previous emailed link stops working immediately. */
  @Post('invitations/:id/resend')
  @Roles(...STAFF_ROLES)
  @RequirePermission('staff.invite')
  resendInvitation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.staffInvitationsService.resend(requireTenantId(user.tenantId), id, `${user.firstName} ${user.lastName}`);
  }

  /**
   * Owner-managed staff administration (2026-10): permanently cancels a
   * still-PENDING invitation. Same permission as sending one — cancelling
   * an invite is part of the same "who can bring people on" authority, not
   * the broader staff.manage surface (role/status/removal).
   */
  @Post('invitations/:id/revoke')
  @Roles(...STAFF_ROLES)
  @RequirePermission('staff.invite')
  revokeInvitation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.staffInvitationsService.revoke(requireTenantId(user.tenantId), id, user.id);
  }

  /**
   * Changes an existing staff member's tier. Tenant-scoped lookup (404 on
   * a cross-tenant id, same as every other module) — UsersService
   * additionally rejects a change that would leave the tenant with zero
   * active OWNERs, and (for a non-owner caller) unconditionally rejects
   * any attempt to touch an OWNER target, promote anyone to OWNER, or act
   * on the caller's own row — see UsersService.updateRole's own doc
   * comment.
   */
  @Patch(':id/role')
  @Roles(...STAFF_ROLES)
  @RequirePermission('staff.manage')
  updateRole(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStaffRoleDto) {
    return this.usersService.updateRole(requireTenantId(user.tenantId), user.id, user.role, id, dto.role);
  }

  /**
   * Deactivate/reactivate a staff member. Same tenant-scoping, last-
   * active-OWNER protection, and non-owner-caller restrictions as
   * updateRole above.
   */
  @Patch(':id/status')
  @Roles(...STAFF_ROLES)
  @RequirePermission('staff.manage')
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStaffStatusDto) {
    return this.usersService.setActiveStatus(requireTenantId(user.tenantId), user.id, user.role, id, dto.isActive);
  }

  /**
   * RBAC permissions (2026-10): sets a staff member's fine-grained
   * permission set. See UsersService.updatePermissions's own doc comment
   * for the full set of guards (OWNER target rejected, self-escalation
   * rejected, non-owner caller can't grant what they don't themselves
   * have).
   */
  @Patch(':id/permissions')
  @Roles(...STAFF_ROLES)
  @RequirePermission('staff.permissions')
  updatePermissions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStaffPermissionsDto) {
    return this.usersService.updatePermissions(
      requireTenantId(user.tenantId),
      user.id,
      user.role,
      user.permissions,
      id,
      dto.permissions,
    );
  }

  /**
   * Owner-managed staff administration (2026-10): the "Removed" section
   * of the Staff page — see UsersService.findRemovedStaffForTenant's own
   * doc comment. Gated by staff.manage, the same permission that removes
   * a staff member in the first place.
   */
  @Get('staff/removed')
  @Roles(...STAFF_ROLES)
  @RequirePermission('staff.manage')
  listRemovedStaff(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findRemovedStaffForTenant(requireTenantId(user.tenantId));
  }

  /**
   * Owner-managed staff administration (2026-10): removes a staff member
   * without deleting their row or any historical record — see
   * UsersService.removeStaffMember's own doc comment. One-way; the only
   * path back is a fresh invitation (POST /users/invite) to the same
   * email, now that it's free.
   */
  @Post(':id/remove')
  @Roles(...STAFF_ROLES)
  @RequirePermission('staff.manage')
  removeStaffMember(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.removeStaffMember(requireTenantId(user.tenantId), user.id, user.role, id);
  }

  /**
   * Owner-managed staff administration (2026-10): triggers a password-
   * reset email for one specific staff member — the caller never sees or
   * sets the new password. See UsersService.triggerPasswordReset's own
   * doc comment for the exact-id scoping that makes this safe even when
   * this email also matches an account at a different tenant.
   */
  @Post(':id/password-reset')
  @Roles(...STAFF_ROLES)
  @RequirePermission('staff.manage')
  triggerPasswordReset(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.triggerPasswordReset(requireTenantId(user.tenantId), user.id, user.role, id);
  }
}
