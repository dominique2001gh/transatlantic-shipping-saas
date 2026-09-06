import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import { AllowWhenSuspended } from '../common/decorators/allow-when-suspended.decorator';
import { AnyAuthenticatedRole } from '../common/decorators/any-authenticated-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { SuspendTenantDto } from './dto/suspend-tenant.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /** Any authenticated tenant staff/customer can see their own tenant's public profile. */
  @Get('me')
  @AnyAuthenticatedRole()
  @AllowWhenSuspended()
  getOwnTenant(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) {
      throw new ForbiddenException('No tenant context for this account');
    }
    return this.tenantsService.findOwnTenant(user.tenantId);
  }

  @Get()
  @Roles(UserRole.PLATFORM_ADMIN)
  findAll() {
    return this.tenantsService.findAll();
  }

  /** AnanseLogix Phase 1: the /platform/tenants admin page's data source — see TenantsService.findAllForPlatformOverview's own doc comment. */
  @Get('platform-overview')
  @Roles(UserRole.PLATFORM_ADMIN)
  findAllForPlatformOverview() {
    return this.tenantsService.findAllForPlatformOverview();
  }

  @Get(':id')
  @Roles(UserRole.PLATFORM_ADMIN)
  findOne(@Param('id') id: string) {
    return this.tenantsService.findById(id);
  }

  @Post()
  @Roles(UserRole.PLATFORM_ADMIN)
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @Post(':id/suspend')
  @Roles(UserRole.PLATFORM_ADMIN)
  suspend(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: SuspendTenantDto) {
    return this.tenantsService.suspend(id, user.id, dto.reason);
  }

  @Post(':id/reactivate')
  @Roles(UserRole.PLATFORM_ADMIN)
  reactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.reactivate(id, user.id);
  }
}
