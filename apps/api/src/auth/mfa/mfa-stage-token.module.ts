import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MfaStageTokenService } from './mfa-stage-token.service';

/**
 * Platform-wide staff MFA (2026-10): a standalone leaf module (no
 * dependency on AuthModule or MfaModule) specifically so both can depend
 * on it without a circular import — AuthService needs this to *issue*
 * stage tokens, MfaModule needs it to *verify* them, and MfaModule
 * separately depends on AuthModule (for AuthService.buildLoginResponse),
 * so AuthModule itself must never depend on MfaModule.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [MfaStageTokenService],
  exports: [MfaStageTokenService],
})
export class MfaStageTokenModule {}
