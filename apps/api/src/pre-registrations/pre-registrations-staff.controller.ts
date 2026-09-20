import { Controller, Get, Param, Query } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { OPERATIONS_ROLES } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { PreRegistrationsService } from './pre-registrations.service';

/**
 * Customer Self-Service Pre-Registration, Stage 1: the staff-facing lookup
 * surface a later stage's Quick Receive "Find Pre-Registration" entry point
 * will call. Same OPERATIONS_ROLES gate as WarehouseController (every
 * warehouse-floor route in this app is OWNER/MANAGER/STAFF; FINANCE has
 * none of this, same as it has no warehouse access). Deliberately its own
 * controller/route prefix rather than added to WarehouseController — this
 * keeps Stage 1 from touching warehouse.controller.ts / warehouse.module.ts
 * at all, per the explicit no-regression scope for this stage.
 *
 * Read-only: no method here converts, mutates, or otherwise advances a
 * pre-registration's status — that's explicitly a later stage.
 */
@Controller('pre-registrations')
@RequireEntitlement(EntitlementFeature.OPERATIONS_SOFTWARE)
@Roles(...OPERATIONS_ROLES)
export class PreRegistrationsStaffController {
  constructor(private readonly preRegistrationsService: PreRegistrationsService) {}

  /** "Select it from pending pre-registrations." Must be declared before ':id' so it isn't swallowed as a param. */
  @Get('pending')
  listPending(@CurrentUser() user: AuthenticatedUser) {
    return this.preRegistrationsService.listPendingForStaff(requireTenantId(user.tenantId));
  }

  /** Scanning a PRE-… QR/reference — exact match, mirrors WarehouseController's own `scan` route. */
  @Get('scan')
  scan(@CurrentUser() user: AuthenticatedUser, @Query('code') code?: string) {
    return this.preRegistrationsService.findByReferenceForStaff(requireTenantId(user.tenantId), code ?? '');
  }

  /** Typing a reference, or searching by customer name/phone — mirrors WarehouseController's own `search` route. */
  @Get('search')
  search(@CurrentUser() user: AuthenticatedUser, @Query('query') query?: string) {
    return this.preRegistrationsService.searchForStaff(requireTenantId(user.tenantId), query ?? '');
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.preRegistrationsService.findOneForStaff(requireTenantId(user.tenantId), id);
  }
}
