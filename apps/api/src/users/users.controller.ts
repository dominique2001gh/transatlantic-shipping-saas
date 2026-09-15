import { Body, Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { STAFF_ADMIN_ROLES, STAFF_ROLES } from '@transatlantic/shared';
import { AuthService } from '../auth/auth.service';
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
