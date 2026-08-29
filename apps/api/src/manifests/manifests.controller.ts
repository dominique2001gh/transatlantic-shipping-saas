import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ManifestStatus, ShipmentMode, UserRole } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { AssignContainerDto } from './dto/assign-container.dto';
import { AssignItemDto } from './dto/assign-item.dto';
import { CreateManifestDto } from './dto/create-manifest.dto';
import { UnassignDto } from './dto/unassign.dto';
import { ManifestsService } from './manifests.service';

/** Planning task, same set ContainersController uses for booking/assigning a container — no scanning involved. */
const OPERATIONS_ROLES = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_STAFF,
  UserRole.CUSTOMER_SERVICE,
];
const VIEW_ROLES = [...OPERATIONS_ROLES, UserRole.ACCOUNTANT, UserRole.DESTINATION_AGENT];

/** Direct (air) item assignment is a scan-based floor action — same narrower set WarehouseController uses. */
const WAREHOUSE_ROLES = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_STAFF,
];

/**
 * Finalizing and departing are both bigger, harder-to-reverse actions —
 * same narrower set, staff excluded. Departing in particular is the most
 * consequential action in the whole manifest lifecycle (it's real,
 * physical movement), so it deliberately isn't opened up any wider than
 * finalize.
 */
const FINALIZE_ROLES = [UserRole.TENANT_OWNER, UserRole.TENANT_ADMIN, UserRole.WAREHOUSE_MANAGER];
const DEPART_ROLES = FINALIZE_ROLES;

const VALID_STATUSES = new Set<string>(Object.values(ManifestStatus));
const VALID_MODES = new Set<string>(Object.values(ShipmentMode));

/**
 * Milestone 3E-A: create/list/detail. Milestone 3E-B: assignment/
 * unassignment of containers (Ocean/RoRo) and direct items (Air).
 * Milestone 3E-C: finalize (DRAFT -> FINALIZED) and depart
 * (FINALIZED -> DEPARTED).
 */
@Controller('manifests')
export class ManifestsController {
  constructor(private readonly manifestsService: ManifestsService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('shipmentMode') shipmentMode?: string,
  ) {
    const validStatus = status && VALID_STATUSES.has(status) ? (status as ManifestStatus) : undefined;
    const validMode = shipmentMode && VALID_MODES.has(shipmentMode) ? (shipmentMode as ShipmentMode) : undefined;
    return this.manifestsService.findAll(requireTenantId(user.tenantId), {
      status: validStatus,
      shipmentMode: validMode,
    });
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.manifestsService.findById(requireTenantId(user.tenantId), id);
  }

  @Post()
  @Roles(...OPERATIONS_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateManifestDto) {
    return this.manifestsService.create(requireTenantId(user.tenantId), dto);
  }

  @Post(':id/containers/:containerId')
  @Roles(...OPERATIONS_ROLES)
  assignContainer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') manifestId: string,
    @Param('containerId') containerId: string,
    @Body() dto: AssignContainerDto,
  ) {
    return this.manifestsService.assignContainer(requireTenantId(user.tenantId), user.id, manifestId, containerId, dto);
  }

  @Delete(':id/containers/:containerId')
  @Roles(...OPERATIONS_ROLES)
  unassignContainer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') manifestId: string,
    @Param('containerId') containerId: string,
    @Body() dto: UnassignDto,
  ) {
    return this.manifestsService.unassignContainer(requireTenantId(user.tenantId), user.id, manifestId, containerId, dto);
  }

  @Post(':id/items/:itemId')
  @Roles(...WAREHOUSE_ROLES)
  assignItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') manifestId: string,
    @Param('itemId') itemId: string,
    @Body() dto: AssignItemDto,
  ) {
    return this.manifestsService.assignItem(requireTenantId(user.tenantId), user.id, manifestId, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  @Roles(...WAREHOUSE_ROLES)
  unassignItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') manifestId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UnassignDto,
  ) {
    return this.manifestsService.unassignItem(requireTenantId(user.tenantId), user.id, manifestId, itemId, dto);
  }

  @Post(':id/finalize')
  @Roles(...FINALIZE_ROLES)
  finalize(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.manifestsService.finalize(requireTenantId(user.tenantId), user.id, id);
  }

  @Post(':id/depart')
  @Roles(...DEPART_ROLES)
  depart(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.manifestsService.depart(requireTenantId(user.tenantId), user.id, id);
  }
}
