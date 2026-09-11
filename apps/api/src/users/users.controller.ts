import { Body, Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { STAFF_ROLES, UserRole } from '@transatlantic/shared';
import { AuthService } from '../auth/auth.service';
import { AnyAuthenticatedRole } from '../common/decorators/any-authenticated-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { InviteStaffDto } from '../staff-invitations/dto/invite-staff.dto';
import { StaffInvitationsService } from '../staff-invitations/staff-invitations.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UsersService } from './users.service';

/**
 * Staff Invitations stage: invite/list-invitations/resend are scoped to
 * TENANT_OWNER/WAREHOUSE_MANAGER only — deliberately narrower than
 * STAFF_ROLES (which just gates viewing the staff list), matching the
 * same rule OnboardingController's own staff/invite route enforces (see
 * that controller's doc comment on why this differs from
 * ONBOARDING_ROLES). TENANT_ADMIN cannot invite/manage staff under this
 * rule, by explicit product decision.
 */
const STAFF_INVITE_ROLES = [UserRole.TENANT_OWNER, UserRole.WAREHOUSE_MANAGER];

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
   * Staff Invitations stage: the owner/manager enters name+email+role
   * here; the invited employee is the only one who ever sets a password
   * (see AuthController.acceptInvite). Never creates a User directly.
   */
  @Post('invite')
  @Roles(...STAFF_INVITE_ROLES)
  inviteStaff(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteStaffDto) {
    return this.staffInvitationsService.invite(requireTenantId(user.tenantId), user.id, `${user.firstName} ${user.lastName}`, dto);
  }

  @Get('invitations')
  @Roles(...STAFF_INVITE_ROLES)
  listInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.staffInvitationsService.listForTenant(requireTenantId(user.tenantId));
  }

  /** Regenerates the token on the same invitation row — the previous emailed link stops working immediately. */
  @Post('invitations/:id/resend')
  @Roles(...STAFF_INVITE_ROLES)
  resendInvitation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.staffInvitationsService.resend(requireTenantId(user.tenantId), id, `${user.firstName} ${user.lastName}`);
  }
}
