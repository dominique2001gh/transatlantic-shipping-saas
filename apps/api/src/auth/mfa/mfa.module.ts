import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { NotificationProvidersModule } from '../../notifications/providers/notification-providers.module';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { MfaStageGuard } from './mfa-stage.guard';
import { MfaStageTokenModule } from './mfa-stage-token.module';

/**
 * Email-based staff MFA (2026-10): depends on AuthModule (for
 * AuthService.buildLoginResponse, once a code is verified),
 * MfaStageTokenModule (to verify the stage token MfaStageGuard accepts),
 * and NotificationProvidersModule (EMAIL_PROVIDER, to actually send the
 * code). AuthModule itself never imports this module — see
 * MfaStageTokenModule's own doc comment for why that would be circular;
 * AuthService.login only ever issues a stage token, it never calls into
 * MfaService directly, which is what keeps this one-directional.
 */
@Module({
  imports: [AuthModule, MfaStageTokenModule, NotificationProvidersModule],
  controllers: [MfaController],
  providers: [MfaService, MfaStageGuard],
  exports: [MfaService],
})
export class MfaModule {}
