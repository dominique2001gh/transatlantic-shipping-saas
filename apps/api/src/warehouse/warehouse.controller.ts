import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { OPERATIONS_ROLES, ShipmentItemStatus } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { DeliverItemDto } from './dto/deliver-item.dto';
import { DestinationReceiveItemDto } from './dto/destination-receive-item.dto';
import { DispatchItemDto } from './dto/dispatch-item.dto';
import { PickupItemDto } from './dto/pickup-item.dto';
import { ProcessItemDto } from './dto/process-item.dto';
import { ReceiveItemDto } from './dto/receive-item.dto';
import { ReturnItemDto } from './dto/return-item.dto';
import { WarehouseService } from './warehouse.service';

const VALID_ITEM_STATUSES = new Set<string>(Object.values(ShipmentItemStatus));

/**
 * RBAC V1: every warehouse route — origin receive/process, destination
 * receive, pickup, dispatch, deliver, return — is OPERATIONS_ROLES
 * (OWNER/MANAGER/STAFF). The old split between "origin-only" WAREHOUSE_ROLES
 * and "origin+destination" DESTINATION_RECEIVE_ROLES existed only because
 * WAREHOUSE_STAFF and DESTINATION_AGENT were once separate roles with
 * different scopes; both are now the single STAFF tier, whose approved V1
 * definition explicitly covers "warehouse receiving/processing/loading/
 * destination receiving/pickup/delivery" end to end, so one role list
 * covers every route in this controller. FINANCE has none of this — no
 * warehouse access at all, not even view.
 */
@Controller('warehouse')
@RequireEntitlement(EntitlementFeature.OPERATIONS_SOFTWARE)
@Roles(...OPERATIONS_ROLES)
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get('locations')
  listLocations(@CurrentUser() user: AuthenticatedUser) {
    return this.warehouseService.listLocations(requireTenantId(user.tenantId));
  }

  @Get('scan')
  scan(@CurrentUser() user: AuthenticatedUser, @Query('code') code?: string) {
    return this.warehouseService.resolveScan(requireTenantId(user.tenantId), code ?? '');
  }

  @Get('search')
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
  destinationReceive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() dto: DestinationReceiveItemDto,
  ) {
    return this.warehouseService.destinationReceiveItem(requireTenantId(user.tenantId), user.id, itemId, dto);
  }

  /** Customer Pickup milestone. See WarehouseService.pickupItem for the eligibility/warehouse-match rules. */
  @Post('items/:itemId/pickup')
  pickup(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string, @Body() dto: PickupItemDto) {
    return this.warehouseService.pickupItem(requireTenantId(user.tenantId), user.id, itemId, dto);
  }

  /** Delivery/Driver Dispatch milestone. See WarehouseService.dispatchItem. */
  @Post('items/:itemId/dispatch')
  dispatch(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string, @Body() dto: DispatchItemDto) {
    return this.warehouseService.dispatchItem(requireTenantId(user.tenantId), user.id, itemId, dto);
  }

  /** Delivery/Driver Dispatch milestone. See WarehouseService.deliverItem. */
  @Post('items/:itemId/deliver')
  deliver(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string, @Body() dto: DeliverItemDto) {
    return this.warehouseService.deliverItem(requireTenantId(user.tenantId), user.id, itemId, dto);
  }

  /** Delivery/Driver Dispatch milestone. See WarehouseService.returnItem. */
  @Post('items/:itemId/return')
  returnToWarehouse(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string, @Body() dto: ReturnItemDto) {
    return this.warehouseService.returnItem(requireTenantId(user.tenantId), user.id, itemId, dto);
  }
}
