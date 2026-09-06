import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@transatlantic/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { SaasAnalyticsService } from './saas-analytics.service';

/** AnanseLogix Phase 2: platform-wide funnel view for /platform/analytics — see SaasAnalyticsService's own doc comment. */
@Controller('platform/saas-analytics')
@Roles(UserRole.PLATFORM_ADMIN)
export class SaasAnalyticsController {
  constructor(private readonly saasAnalyticsService: SaasAnalyticsService) {}

  @Get()
  getOverview() {
    return this.saasAnalyticsService.getOverview();
  }
}
