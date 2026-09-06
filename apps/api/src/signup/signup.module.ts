import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { SaasPlansModule } from '../saas-plans/saas-plans.module';
import { StripeModule } from '../stripe/stripe.module';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';

/**
 * ThrottlerModule.forRoot is imported here only — not a global APP_GUARD —
 * so rate limiting applies exclusively to SignupController's public
 * routes, the same scoping LeadsModule/TrackingModule already establish
 * for their own public, unauthenticated, abuse-prone endpoints.
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 20 }]), StripeModule, SaasPlansModule],
  controllers: [SignupController],
  providers: [SignupService],
})
export class SignupModule {}
