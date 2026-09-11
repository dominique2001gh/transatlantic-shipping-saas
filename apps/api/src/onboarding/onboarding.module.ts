import { Module } from '@nestjs/common';
import { SaasPlansModule } from '../saas-plans/saas-plans.module';
import { StaffInvitationsModule } from '../staff-invitations/staff-invitations.module';
import { StripeModule } from '../stripe/stripe.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/** Free Trial stage: SaasPlansModule added for startPaidSubscription's findActivePriceForPlanKey lookup — the same source of truth SignupService's own checkout uses. */
@Module({
  imports: [StripeModule, StaffInvitationsModule, SaasPlansModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
