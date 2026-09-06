import { Module } from '@nestjs/common';
import { PublicSiteConfigController } from './public-site-config.controller';
import { SiteConfigController } from './site-config.controller';
import { SiteConfigService } from './site-config.service';

@Module({
  controllers: [PublicSiteConfigController, SiteConfigController],
  providers: [SiteConfigService],
})
export class SiteConfigModule {}
