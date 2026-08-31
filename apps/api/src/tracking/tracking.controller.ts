import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { TrackingService } from './tracking.service';

/**
 * Stage 2A: the public tracking lookup — no authentication, deliberately
 * (a customer with a tracking number and no account must be able to use
 * it). Rate-limited locally to this one route via a module-scoped
 * ThrottlerModule (see TrackingModule) rather than a global APP_GUARD, so
 * this is the only endpoint in the API affected by it — every other
 * controller's behavior (including the existing e2e suite's request
 * volume) is completely unchanged.
 */
@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get('public')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  lookupPublic(
    @Query('tenantSlug') tenantSlug?: string,
    @Query('trackingNumber') trackingNumber?: string,
    @Query('lastName') lastName?: string,
  ) {
    return this.trackingService.lookupPublic(tenantSlug ?? '', trackingNumber ?? '', lastName ?? '');
  }
}
