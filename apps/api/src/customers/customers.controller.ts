import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/** Creating/editing customer profiles is a front-office/admin task. */
const MANAGE_ROLES = [
  UserRole.TENANT_OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.CUSTOMER_SERVICE,
];
/** Broader read access — warehouse staff routinely need to look up whose shipment they're handling. */
const VIEW_ROLES = [
  ...MANAGE_ROLES,
  UserRole.WAREHOUSE_STAFF,
  UserRole.ACCOUNTANT,
  UserRole.DESTINATION_AGENT,
];

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @Roles(...VIEW_ROLES)
  findAll(@CurrentUser() user: AuthenticatedUser, @Query('search') search?: string) {
    return this.customersService.findAll(requireTenantId(user.tenantId), search);
  }

  @Get(':id')
  @Roles(...VIEW_ROLES)
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customersService.findById(requireTenantId(user.tenantId), id);
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(requireTenantId(user.tenantId), dto);
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(requireTenantId(user.tenantId), id, dto);
  }
}
