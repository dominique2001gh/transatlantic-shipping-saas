import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadsService } from './leads.service';

/**
 * Website Launch: the marketing site's Contact and Request-a-Quote forms
 * both post here — no authentication, deliberately (a visitor has no
 * account). Kept as its own controller, entirely separate from
 * LeadsController's staff-gated routes, so the isolation is auditable at
 * a glance — the same reasoning CustomerPortalController's own doc
 * comment gives for staying separate from CustomersController.
 *
 * Rate-limited locally to this one route via a module-scoped
 * ThrottlerModule (see LeadsModule) rather than a global APP_GUARD, the
 * same pattern TrackingController already established for the other
 * public, unauthenticated, abuse-prone endpoint in this API.
 */
@Controller('public/leads')
export class PublicLeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreateLeadDto) {
    return this.leadsService.create(dto);
  }
}
