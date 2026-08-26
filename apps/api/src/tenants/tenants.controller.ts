import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /** Any authenticated tenant staff/customer can see their own tenant's public profile. */
  @Get('me')
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
}
