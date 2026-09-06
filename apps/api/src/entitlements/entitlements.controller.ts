import { Controller, Get } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { AllowWhenSuspended } from '../common/decorators/allow-when-suspended.decorator';
import { AnyAuthenticatedRole } from '../common/decorators/any-authenticated-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { EntitlementsService } from './entitlements.service';

@Controller('entitlements')
export class EntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get('me')
  @AnyAuthenticatedRole()
  @AllowWhenSuspended()
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.entitlementsService.findAllForTenant(requireTenantId(user.tenantId));
  }
}
