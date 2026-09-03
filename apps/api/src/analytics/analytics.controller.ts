import { Controller, Get, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ANALYTICS_ROLES, DASHBOARD_ROLES } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

/**
 * Stage 4: Owner/Manager Analytics. Every handler resolves tenantId from
 * the caller's verified JWT via requireTenantId, never a query param or
 * route param — same discipline as every other controller in this
 * codebase — so no handler here can be tricked into returning another
 * tenant's figures.
 *
 * `overview` is deliberately `@Roles(...DASHBOARD_ROLES)`, not
 * `ANALYTICS_ROLES` — it backs the general Dashboard Overview tiles
 * (Active Shipments, Customers, Open Invoices, Containers In Transit),
 * which carry no financial figures and have always been open to any
 * staff role that can reach /dashboard at all. Every other route here is
 * `ANALYTICS_ROLES`-gated: full-tenant financial visibility (revenue,
 * payments, outstanding invoices) plus cross-warehouse operational
 * visibility is Owner/Admin/Manager-only, per explicit product decision
 * — see ANALYTICS_ROLES's own doc comment in @transatlantic/shared.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @Roles(...DASHBOARD_ROLES)
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.getOverview(requireTenantId(user.tenantId));
  }

  @Get('alerts')
  @Roles(...ANALYTICS_ROLES)
  alerts(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.getAlerts(requireTenantId(user.tenantId));
  }

  @Get('revenue')
  @Roles(...ANALYTICS_ROLES)
  revenue(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getRevenue(requireTenantId(user.tenantId), query);
  }

  @Get('operations')
  @Roles(...ANALYTICS_ROLES)
  operations(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getOperations(requireTenantId(user.tenantId), query);
  }

  @Get('destinations')
  @Roles(...ANALYTICS_ROLES)
  destinations(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getDestinations(requireTenantId(user.tenantId), query);
  }

  @Get('customers')
  @Roles(...ANALYTICS_ROLES)
  customers(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getCustomers(requireTenantId(user.tenantId), query);
  }

  @Get('exceptions')
  @Roles(...ANALYTICS_ROLES)
  exceptions(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getExceptions(requireTenantId(user.tenantId), query);
  }
}
