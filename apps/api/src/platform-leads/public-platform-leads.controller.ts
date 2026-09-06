import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CreatePlatformLeadDto } from './dto/create-platform-lead.dto';
import { PlatformLeadsService } from './platform-leads.service';

/** AnanseLogix Phase 1: the /demo page's form posts here — no authentication, same posture as PublicLeadsController. */
@Controller('public/platform-leads')
export class PublicPlatformLeadsController {
  constructor(private readonly platformLeadsService: PlatformLeadsService) {}

  @Post()
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreatePlatformLeadDto) {
    return this.platformLeadsService.create(dto);
  }
}
