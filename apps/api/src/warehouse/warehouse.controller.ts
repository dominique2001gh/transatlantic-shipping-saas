import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ShipmentItemStatus, UserRole } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
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

@Controller('warehouse')
@Roles(...WAREHOUSE_ROLES)
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
}
