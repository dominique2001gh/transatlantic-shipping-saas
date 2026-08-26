import { Controller, ForbiddenException, Get } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { STAFF_ROLES } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Returns the profile of whoever the access token belongs to. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
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
}
