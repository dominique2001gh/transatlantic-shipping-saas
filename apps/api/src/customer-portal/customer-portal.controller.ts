import { Controller, Get, Param } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireCustomerId, requireTenantId } from '../common/tenant/tenant.util';
import { CustomerPortalService } from './customer-portal.service';

/**
 * Stage 2C: the authenticated customer-portal surface. `@Roles(CUSTOMER)`
 * at the class level covers every route in this file — no exceptions, no
 * per-method allow-lists to keep in sync. Nothing here is reachable by a
 * staff token (RolesGuard rejects it), and — see CustomersController's and
 * ShipmentsController's own @Roles() allow-lists, neither of which
 * includes CUSTOMER — no staff route anywhere else in the API is reachable
 * by a CUSTOMER token either. Kept as its own controller/module rather
 * than folded into CustomersController/ShipmentsController specifically so
 * this isolation is auditable at a glance: every handler in this file is
 * customer-only, full stop.
 */
@Controller('portal')
@Roles(UserRole.CUSTOMER)
export class CustomerPortalController {
  constructor(private readonly customerPortalService: CustomerPortalService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.customerPortalService.getProfile(requireTenantId(user.tenantId), requireCustomerId(user.customerId));
  }

  @Get('shipments')
  shipments(@CurrentUser() user: AuthenticatedUser) {
    return this.customerPortalService.listShipments(
      requireTenantId(user.tenantId),
      requireCustomerId(user.customerId),
    );
  }

  @Get('shipments/:id')
  shipmentDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customerPortalService.getShipment(
      requireTenantId(user.tenantId),
      requireCustomerId(user.customerId),
      id,
    );
  }
}
