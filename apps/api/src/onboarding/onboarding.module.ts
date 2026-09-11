import { Module } from '@nestjs/common';
import { StaffInvitationsModule } from '../staff-invitations/staff-invitations.module';
import { StripeModule } from '../stripe/stripe.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [StripeModule, StaffInvitationsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
