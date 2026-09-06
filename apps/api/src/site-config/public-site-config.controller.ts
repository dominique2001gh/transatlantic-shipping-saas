import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SiteConfigService } from './site-config.service';

/** AnanseLogix Phase 2: what a future tenant-branded public site would render from — see SiteConfigService's own doc comment. */
@Controller('public/site-config')
export class PublicSiteConfigController {
  constructor(private readonly siteConfigService: SiteConfigService) {}

  @Get(':slug')
  @Public()
  findBySlug(@Param('slug') slug: string) {
    return this.siteConfigService.findPublicBySlug(slug);
  }
}
