import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ONBOARDING_ROLES } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { UpdateSiteConfigDto } from './dto/update-site-config.dto';
import { UpdateTenantLocationsDto } from './dto/update-tenant-locations.dto';
import { SiteConfigService } from './site-config.service';

/**
 * AnanseLogix Phase 2: lets a tenant prepare its own public-site content
 * regardless of current plan — see SiteConfigService's own doc comment for
 * why the write side is never entitlement-gated (only the public read is).
 * Scoped to ONBOARDING_ROLES, same as the onboarding wizard's Branding
 * step this naturally extends.
 */
@Controller('site-config')
@Roles(...ONBOARDING_ROLES)
export class SiteConfigController {
  constructor(private readonly siteConfigService: SiteConfigService) {}

  @Get()
  getOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.siteConfigService.getOwn(requireTenantId(user.tenantId));
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSiteConfigDto) {
    return this.siteConfigService.updateOwn(requireTenantId(user.tenantId), dto);
  }

  @Get('locations')
  getLocations(@CurrentUser() user: AuthenticatedUser) {
    return this.siteConfigService.getOwnLocations(requireTenantId(user.tenantId));
  }

  @Put('locations')
  replaceLocations(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateTenantLocationsDto) {
    return this.siteConfigService.replaceLocations(requireTenantId(user.tenantId), dto);
  }
}
