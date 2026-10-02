import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth.module';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { MfaStageGuard } from './mfa-stage.guard';
import { MfaStageTokenModule } from './mfa-stage-token.module';

/**
 * Platform-wide staff MFA (2026-10): depends on AuthModule (for
 * AuthService.buildLoginResponse, once an MFA step succeeds) and
 * MfaStageTokenModule (to verify the stage token MfaStageGuard accepts).
 * AuthModule itself never imports this module — see
 * MfaStageTokenModule's own doc comment for why that would be circular.
 * JwtModule is registered a second time here (identical config) purely
 * because MfaService.beginFactorReplace/completeFactorReplace sign/verify
 * their own short-lived token directly — duplicating a stateless,
 * config-only module registration is cheap and avoids yet another
 * cross-module dependency for one pair of methods.
 */
@Module({
  imports: [
    AuthModule,
    MfaStageTokenModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [MfaController],
  providers: [MfaService, MfaStageGuard],
  exports: [MfaService],
})
export class MfaModule {}
