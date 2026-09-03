import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { NotificationProvidersModule } from '../notifications/providers/notification-providers.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { PublicLeadsController } from './public-leads.controller';

/**
 * Website Launch: ThrottlerModule.forRoot is imported here only — not
 * registered as a global APP_GUARD — so rate limiting applies exclusively
 * to PublicLeadsController's public submit route (see its own
 * @UseGuards), the same scoping TrackingModule already established for
 * the other public, unauthenticated, abuse-prone endpoint in this API.
 * A tighter limit than tracking's (10/min vs 20/min) — submitting a form
 * is a much lower-frequency legitimate action than repeated tracking
 * lookups.
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 10 }]), NotificationProvidersModule],
  controllers: [PublicLeadsController, LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
