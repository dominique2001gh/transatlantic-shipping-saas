import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ShipmentItemStatus, UserRole } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { DestinationReceiveItemDto } from './dto/destination-receive-item.dto';
import { ProcessItemDto } from './dto/process-item.dto';
import { ReceiveItemDto } from './dto/receive-item.dto';
import { WarehouseService } from './warehouse.service';

const VALID_ITEM_STATUSES = new Set<string>(Object.values(ShipmentItemStatus));

/**
 * Physical warehouse operations are narrower than general shipment
 * management (3A's OPERATIONS_ROLES) — CUSTOMER_SERVICE can manage
 * shipments/customers but doesn't do floor-level receiving.
 */
const WAREHOUSE_ROLES = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_STAFF,
];

/**
 * Milestone 3F: destination receiving is exactly the action
 * DESTINATION_AGENT exists for — a deliberate, additive widening (this
 * role has been view-only everywhere until now). Overrides the
 * class-level @Roles(...WAREHOUSE_ROLES) only for this one route
 * (RolesGuard uses getAllAndOverride — method-level wins); every other
 * warehouse route's access is unchanged.
 */
const DESTINATION_RECEIVE_ROLES = [...WAREHOUSE_ROLES, UserRole.DESTINATION_AGENT];

@Controller('warehouse')
@Roles(...WAREHOUSE_ROLES)
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  // locations/scan/search/inventory/activity are widened to
  // DESTINATION_RECEIVE_ROLES (not left at the class-level default) so a
  // DESTINATION_AGENT can actually use the scan-first destination-receive
  // workflow this page hosts — resolving an item, and seeing the same
  // warehouse's live inventory/activity, are read-only and don't grant
  // any new write access. receive/process below stay WAREHOUSE_ROLES
  // only — a destination agent doesn't do origin receiving.

  @Get('locations')
  @Roles(...DESTINATION_RECEIVE_ROLES)
  listLocations(@CurrentUser() user: AuthenticatedUser) {
    return this.warehouseService.listLocations(requireTenantId(user.tenantId));
  }

  @Get('scan')
  @Roles(...DESTINATION_RECEIVE_ROLES)
  scan(@CurrentUser() user: AuthenticatedUser, @Query('code') code?: string) {
    return this.warehouseService.resolveScan(requireTenantId(user.tenantId), code ?? '');
  }

  @Get('search')
  @Roles(...DESTINATION_RECEIVE_ROLES)
  search(@CurrentUser() user: AuthenticatedUser, @Query('query') query?: string) {
    return this.warehouseService.searchItems(requireTenantId(user.tenantId), query ?? '');
  }

  @Post('items/:itemId/receive')
  receive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() dto: ReceiveItemDto,
  ) {
    return this.warehouseService.receiveItem(requireTenantId(user.tenantId), user.id, itemId, dto);
  }

  @Post('items/:itemId/process')
  process(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() dto: ProcessItemDto,
  ) {
    return this.warehouseService.processItem(requireTenantId(user.tenantId), user.id, itemId, dto);
  }

  @Get('inventory')
  @Roles(...DESTINATION_RECEIVE_ROLES)
  inventory(
    @CurrentUser() user: AuthenticatedUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const validStatus = status && VALID_ITEM_STATUSES.has(status) ? (status as ShipmentItemStatus) : undefined;
    return this.warehouseService.getInventory(requireTenantId(user.tenantId), {
      warehouseId,
      search,
      status: validStatus,
    });
  }

  @Get('activity')
  @Roles(...DESTINATION_RECEIVE_ROLES)
  activity(
    @CurrentUser() user: AuthenticatedUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.warehouseService.getRecentActivity(requireTenantId(user.tenantId), {
      warehouseId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('items/:itemId/destination-receive')
  @Roles(...DESTINATION_RECEIVE_ROLES)
  destinationReceive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() dto: DestinationReceiveItemDto,
  ) {
    return this.warehouseService.destinationReceiveItem(requireTenantId(user.tenantId), user.id, itemId, dto);
  }
}
