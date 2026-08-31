import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

/**
 * ThrottlerModule.forRoot is imported here only — not registered as a
 * global APP_GUARD in AppModule — so rate limiting applies exclusively to
 * TrackingController's public lookup route (see its @UseGuards there).
 * No other module/controller in the API is affected.
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 20 }])],
  controllers: [TrackingController],
  providers: [TrackingService],
})
export class TrackingModule {}
