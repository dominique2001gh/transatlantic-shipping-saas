import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CreatePlatformSmsConsentDto } from './dto/create-platform-sms-consent.dto';
import { PlatformSmsConsentService } from './platform-sms-consent.service';

/**
 * Twilio A2P Campaign compliance: ananselogix.com/sms-consent posts here —
 * no authentication, deliberately (a site visitor has no account), same
 * posture PublicLeadsController already establishes for the Contact/Quote
 * forms. Kept as its own controller/module, entirely separate from every
 * tenant-scoped route, so the platform-vs-tenant isolation is auditable
 * at a glance.
 *
 * Rate-limited locally to this one route via a module-scoped
 * ThrottlerModule, mirroring LeadsModule's own exact pattern for the
 * other public, unauthenticated, abuse-prone form endpoint in this API.
 */
@Controller('public/platform-sms-consent')
export class PlatformSmsConsentController {
  constructor(private readonly platformSmsConsentService: PlatformSmsConsentService) {}

  @Post()
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreatePlatformSmsConsentDto) {
    return this.platformSmsConsentService.create(dto);
  }
}
