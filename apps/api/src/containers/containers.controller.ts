import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ContainerStatus, MANAGER_UP_ROLES, OPERATIONS_ROLES } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { ContainersService } from './containers.service';
import { CreateContainerDto } from './dto/create-container.dto';
import { FinalizeContainerDto } from './dto/finalize-container.dto';
import { LoadItemDto } from './dto/load-item.dto';
import { UnloadItemDto } from './dto/unload-item.dto';

/**
 * RBAC V1: view, book, load/unload, and open/close-for-unloading are all
 * OPERATIONS_ROLES (OWNER/MANAGER/STAFF) — the old split between
 * "office task" OPERATIONS_ROLES/VIEW_ROLES and "floor work" WAREHOUSE_ROLES/
 * DESTINATION_ROLES existed only because CUSTOMER_SERVICE/ACCOUNTANT/
 * DESTINATION_AGENT were once separate roles with different scopes; all of
 * that collapses to the single STAFF tier now, so one role list covers
 * every non-finalize route. Sealing a container closed (`finalize`) stays
 * the one supervisor-level, harder-to-reverse action — MANAGER_UP_ROLES
 * (OWNER/MANAGER), STAFF excluded, matching prior behavior exactly.
 * FINANCE has no container access at all, not even view.
 */
const VALID_CONTAINER_STATUSES = new Set<string>(Object.values(ContainerStatus));

@Controller('containers')
@RequireEntitlement(EntitlementFeature.OPERATIONS_SOFTWARE)
export class ContainersController {
  constructor(private readonly containersService: ContainersService) {}

  @Get()
  @Roles(...OPERATIONS_ROLES)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    const validStatus = status && VALID_CONTAINER_STATUSES.has(status) ? (status as ContainerStatus) : undefined;
    return this.containersService.findAll(requireTenantId(user.tenantId), { status: validStatus, warehouseId });
  }

  @Get(':id')
  @Roles(...OPERATIONS_ROLES)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.containersService.findById(requireTenantId(user.tenantId), id);
  }

  @Post()
  @Roles(...OPERATIONS_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateContainerDto) {
    return this.containersService.create(requireTenantId(user.tenantId), dto);
  }

  @Post(':id/items/:itemId')
  @Roles(...OPERATIONS_ROLES)
  loadItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') containerId: string,
    @Param('itemId') itemId: string,
    @Body() dto: LoadItemDto,
  ) {
    return this.containersService.loadItem(requireTenantId(user.tenantId), user.id, containerId, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  @Roles(...OPERATIONS_ROLES)
  unloadItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') containerId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UnloadItemDto,
  ) {
    return this.containersService.unloadItem(requireTenantId(user.tenantId), user.id, containerId, itemId, dto);
  }

  @Post(':id/finalize')
  @Roles(...MANAGER_UP_ROLES)
  finalize(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: FinalizeContainerDto) {
    return this.containersService.finalize(requireTenantId(user.tenantId), user.id, id, dto);
  }

  @Post(':id/open')
  @Roles(...OPERATIONS_ROLES)
  openForUnloading(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.containersService.openForUnloading(requireTenantId(user.tenantId), id);
  }

  @Post(':id/close')
  @Roles(...OPERATIONS_ROLES)
  closeUnloading(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.containersService.closeUnloading(requireTenantId(user.tenantId), id);
  }
}
