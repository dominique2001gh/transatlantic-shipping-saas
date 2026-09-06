import { Module } from '@nestjs/common';
import { SaasAnalyticsController } from './saas-analytics.controller';
import { SaasAnalyticsService } from './saas-analytics.service';

@Module({
  controllers: [SaasAnalyticsController],
  providers: [SaasAnalyticsService],
})
export class SaasAnalyticsModule {}
