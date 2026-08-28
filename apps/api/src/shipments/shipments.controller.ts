import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ShipmentStatus, UserRole } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { CreateTrackingEventDto } from './dto/create-tracking-event.dto';
import { ShipmentItemInputDto } from './dto/shipment-item-input.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { UpdateShipmentItemDto } from './dto/update-shipment-item.dto';
import { ShipmentsService } from './shipments.service';

/**
 * Shipment/item/tracking-event mutation is core warehouse-floor work, so
 * WAREHOUSE_STAFF is included here (unlike CustomersController's
 * MANAGE_ROLES, which is more of a front-office task).
 */
const OPERATIONS_ROLES = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_STAFF,
  UserRole.CUSTOMER_SERVICE,
];
const VIEW_ROLES = [...OPERATIONS_ROLES, UserRole.ACCOUNTANT, UserRole.DESTINATION_AGENT];

const VALID_STATUSES = new Set<string>(Object.values(ShipmentStatus));

@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
  ) {
    const tenantId = requireTenantId(user.tenantId);
    const validStatus = status && VALID_STATUSES.has(status) ? (status as ShipmentStatus) : undefined;
    return this.shipmentsService.findAll(tenantId, { customerId, status: validStatus });
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.shipmentsService.findById(requireTenantId(user.tenantId), id);
  }

  @Post()
  @Roles(...OPERATIONS_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateShipmentDto) {
    return this.shipmentsService.create(requireTenantId(user.tenantId), user.id, dto);
  }

  @Patch(':id')
  @Roles(...OPERATIONS_ROLES)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateShipmentDto,
  ) {
    return this.shipmentsService.update(requireTenantId(user.tenantId), id, dto);
  }

  @Post(':id/items')
  @Roles(...OPERATIONS_ROLES)
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') shipmentId: string,
    @Body() dto: ShipmentItemInputDto,
  ) {
    return this.shipmentsService.addItem(requireTenantId(user.tenantId), user.id, shipmentId, dto);
  }

  @Patch(':id/items/:itemId')
  @Roles(...OPERATIONS_ROLES)
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') shipmentId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateShipmentItemDto,
  ) {
    return this.shipmentsService.updateItem(requireTenantId(user.tenantId), shipmentId, itemId, dto);
  }

  @Get(':id/tracking-events')
  @Roles(...VIEW_ROLES)
  listTrackingEvents(@CurrentUser() user: AuthenticatedUser, @Param('id') shipmentId: string) {
    return this.shipmentsService.listTrackingEvents(requireTenantId(user.tenantId), shipmentId);
  }

  @Post(':id/tracking-events')
  @Roles(...OPERATIONS_ROLES)
  createTrackingEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') shipmentId: string,
    @Body() dto: CreateTrackingEventDto,
  ) {
    return this.shipmentsService.createTrackingEvent(
      requireTenantId(user.tenantId),
      user.id,
      shipmentId,
      dto,
    );
  }
}
