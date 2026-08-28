import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ContainerStatus, UserRole } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { ContainersService } from './containers.service';
import { CreateContainerDto } from './dto/create-container.dto';
import { FinalizeContainerDto } from './dto/finalize-container.dto';
import { LoadItemDto } from './dto/load-item.dto';
import { UnloadItemDto } from './dto/unload-item.dto';

/** Booking/planning a container is an admin/office task, same set as ShipmentsController's OPERATIONS_ROLES. */
const OPERATIONS_ROLES = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_STAFF,
  UserRole.CUSTOMER_SERVICE,
];
const VIEW_ROLES = [...OPERATIONS_ROLES, UserRole.ACCOUNTANT, UserRole.DESTINATION_AGENT];

/** Physically scanning items in/out is floor work — same narrower set WarehouseController uses for receive/process. */
const WAREHOUSE_ROLES = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_STAFF,
];

/** Sealing a container is a bigger, harder-to-reverse action — supervisor-level only, staff excluded. */
const FINALIZE_ROLES = [UserRole.TENANT_OWNER, UserRole.TENANT_ADMIN, UserRole.WAREHOUSE_MANAGER];

const VALID_CONTAINER_STATUSES = new Set<string>(Object.values(ContainerStatus));

@Controller('containers')
export class ContainersController {
  constructor(private readonly containersService: ContainersService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    const validStatus = status && VALID_CONTAINER_STATUSES.has(status) ? (status as ContainerStatus) : undefined;
    return this.containersService.findAll(requireTenantId(user.tenantId), { status: validStatus, warehouseId });
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.containersService.findById(requireTenantId(user.tenantId), id);
  }

  @Post()
  @Roles(...OPERATIONS_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateContainerDto) {
    return this.containersService.create(requireTenantId(user.tenantId), dto);
  }

  @Post(':id/items/:itemId')
  @Roles(...WAREHOUSE_ROLES)
  loadItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') containerId: string,
    @Param('itemId') itemId: string,
    @Body() dto: LoadItemDto,
  ) {
    return this.containersService.loadItem(requireTenantId(user.tenantId), user.id, containerId, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  @Roles(...WAREHOUSE_ROLES)
  unloadItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') containerId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UnloadItemDto,
  ) {
    return this.containersService.unloadItem(requireTenantId(user.tenantId), user.id, containerId, itemId, dto);
  }

  @Post(':id/finalize')
  @Roles(...FINALIZE_ROLES)
  finalize(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: FinalizeContainerDto) {
    return this.containersService.finalize(requireTenantId(user.tenantId), user.id, id, dto);
  }
}
