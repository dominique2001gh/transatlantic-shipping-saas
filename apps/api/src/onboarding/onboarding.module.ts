import { Module } from '@nestjs/common';
import { NotificationProvidersModule } from '../notifications/providers/notification-providers.module';
import { StripeModule } from '../stripe/stripe.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [StripeModule, NotificationProvidersModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
