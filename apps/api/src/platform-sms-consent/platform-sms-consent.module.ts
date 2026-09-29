import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PlatformSmsConsentController } from './platform-sms-consent.controller';
import { PlatformSmsConsentService } from './platform-sms-consent.service';

/**
 * ThrottlerModule.forRoot is imported here only — not registered as a
 * global APP_GUARD — so rate limiting applies exclusively to this
 * module's own public submit route (see the controller's own
 * @UseGuards), the same scoping LeadsModule already establishes for its
 * public form endpoint.
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10 }])],
  controllers: [PlatformSmsConsentController],
  providers: [PlatformSmsConsentService],
})
export class PlatformSmsConsentModule {}
