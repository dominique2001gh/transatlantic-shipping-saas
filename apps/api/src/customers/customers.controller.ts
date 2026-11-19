import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { CUSTOMER_VIEW_ROLES, MANAGER_UP_ROLES, OPERATIONS_ROLES } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/**
 * Creating/editing customer profiles is OPERATIONS_ROLES (OWNER/MANAGER/
 * STAFF) — a front-office/operational task. Viewing is broader
 * (CUSTOMER_VIEW_ROLES = OPERATIONS_ROLES + FINANCE): customer profiles are
 * explicitly part of FINANCE's remit ("customers plus invoices, payments,
 * financial reporting"), so FINANCE can look up whose invoice it's
 * handling, but doesn't create/edit customer profiles itself.
 *
 * Customer Management Phase 3: archive/restore/delete are deliberately
 * narrower than ordinary edits — MANAGER_UP_ROLES (OWNER/MANAGER only),
 * per this feature's own spec requirement, not OPERATIONS_ROLES. STAFF
 * may create and edit customers but may not archive, restore, or delete
 * one.
 */
const MANAGE_ROLES = OPERATIONS_ROLES;
const VIEW_ROLES = CUSTOMER_VIEW_ROLES;
const ARCHIVE_ROLES = MANAGER_UP_ROLES;

@Controller('customers')
@RequireEntitlement(EntitlementFeature.OPERATIONS_SOFTWARE)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  @RequirePermission('customers.view')
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('archived') archived?: string,
  ) {
    return this.customersService.findAll(requireTenantId(user.tenantId), search, archived === 'true');
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  @RequirePermission('customers.view')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customersService.findById(requireTenantId(user.tenantId), id);
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  @RequirePermission('customers.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(requireTenantId(user.tenantId), dto);
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  @RequirePermission('customers.manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(requireTenantId(user.tenantId), user.id, id, dto);
  }

  @Post(':id/archive')
  @Roles(...ARCHIVE_ROLES)
  @RequirePermission('customers.archive')
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customersService.archive(requireTenantId(user.tenantId), user.id, id);
  }

  @Post(':id/restore')
  @Roles(...ARCHIVE_ROLES)
  @RequirePermission('customers.archive')
  restore(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customersService.restore(requireTenantId(user.tenantId), user.id, id);
  }

  @Delete(':id')
  @Roles(...ARCHIVE_ROLES)
  @RequirePermission('customers.archive')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customersService.remove(requireTenantId(user.tenantId), user.id, id);
  }
}
