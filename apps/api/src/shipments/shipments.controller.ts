import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { MANAGER_UP_ROLES, OPERATIONS_ROLES, ShipmentStatus } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { CreateTrackingEventDto } from './dto/create-tracking-event.dto';
import { QuickReceiveDto } from './dto/quick-receive.dto';
import { ShipmentItemInputDto } from './dto/shipment-item-input.dto';
import { UpdateShipmentDto } from './dto/update-shipment.dto';
import { UpdateShipmentItemDto } from './dto/update-shipment-item.dto';
import { ShipmentsService } from './shipments.service';

// RBAC V1: view and mutate are both OPERATIONS_ROLES (OWNER/MANAGER/STAFF) —
// FINANCE has no shipment access at all (not even view; its remit is
// closed-list: customers, invoices, payments, financial reporting only).

const VALID_STATUSES = new Set<string>(Object.values(ShipmentStatus));

@Controller('shipments')
@RequireEntitlement(EntitlementFeature.OPERATIONS_SOFTWARE)
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Get()
  @Roles(...OPERATIONS_ROLES)
  @RequirePermission('shipments.view')
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
  ) {
    const tenantId = requireTenantId(user.tenantId);
    const validStatus = status && VALID_STATUSES.has(status) ? (status as ShipmentStatus) : undefined;
    return this.shipmentsService.findAll(tenantId, { customerId, status: validStatus });
  }

  // Must stay above the @Get(':id') route below — Nest/Express match
  // routes in declaration order, so 'search' would otherwise be swallowed
  // as an :id value.
  @Get('search')
  @Roles(...OPERATIONS_ROLES)
  @RequirePermission('shipments.view')
  search(@CurrentUser() user: AuthenticatedUser, @Query('query') query?: string) {
    return this.shipmentsService.search(requireTenantId(user.tenantId), query ?? '');
  }

  @Get(':id')
  @Roles(...OPERATIONS_ROLES)
  @RequirePermission('shipments.view')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.shipmentsService.findById(requireTenantId(user.tenantId), id);
  }

  @Post()
  @Roles(...OPERATIONS_ROLES)
  @RequirePermission('shipments.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateShipmentDto) {
    return this.shipmentsService.create(requireTenantId(user.tenantId), user.id, dto);
  }

  // Must stay above @Get(':id')/@Patch(':id') is not a concern for a POST
  // route (no @Post(':id') exists on this controller to collide with),
  // but kept next to `create` above since it's the same "make a shipment"
  // family of action. Same OPERATIONS_ROLES gate as every other route
  // here — FINANCE has no shipment access at all, Quick Receive included.
  @Post('quick-receive')
  @Roles(...OPERATIONS_ROLES)
  @RequirePermission('quickreceive.use')
  quickReceive(@CurrentUser() user: AuthenticatedUser, @Body() dto: QuickReceiveDto) {
    return this.shipmentsService.createQuickReceive(requireTenantId(user.tenantId), user.id, dto);
  }

  // Shipment Editing Phase 4: deliberately narrower than every other route
  // on this controller — @Roles(MANAGER_UP_ROLES) + 'shipments.edit', not
  // OPERATIONS_ROLES + 'shipments.manage'. STAFF may create a shipment and
  // add its items, but editing it afterward is OWNER/MANAGER only, per
  // this feature's own spec requirement. The OWNER-only stricter tiers
  // (LOADED and beyond) are enforced inside ShipmentsService.update itself
  // — see resolveEditTier's own doc comment for why that can't be
  // expressed as static route metadata.
  @Patch(':id')
  @Roles(...MANAGER_UP_ROLES)
  @RequirePermission('shipments.edit')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateShipmentDto,
  ) {
    return this.shipmentsService.update(requireTenantId(user.tenantId), user.id, user.role, id, dto);
  }

  @Post(':id/items')
  @Roles(...OPERATIONS_ROLES)
  @RequirePermission('shipments.manage')
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') shipmentId: string,
    @Body() dto: ShipmentItemInputDto,
  ) {
    return this.shipmentsService.addItem(requireTenantId(user.tenantId), user.id, shipmentId, dto);
  }

  // Shipment Editing Phase 4 — same deliberate narrowing as PATCH :id above.
  @Patch(':id/items/:itemId')
  @Roles(...MANAGER_UP_ROLES)
  @RequirePermission('shipments.edit')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') shipmentId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateShipmentItemDto,
  ) {
    return this.shipmentsService.updateItem(requireTenantId(user.tenantId), user.id, user.role, shipmentId, itemId, dto);
  }

  @Get(':id/tracking-events')
  @Roles(...OPERATIONS_ROLES)
  @RequirePermission('shipments.view')
  listTrackingEvents(@CurrentUser() user: AuthenticatedUser, @Param('id') shipmentId: string) {
    return this.shipmentsService.listTrackingEvents(requireTenantId(user.tenantId), shipmentId);
  }

  @Post(':id/tracking-events')
  @Roles(...OPERATIONS_ROLES)
  @RequirePermission('shipments.manage')
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
