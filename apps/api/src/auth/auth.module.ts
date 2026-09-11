import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { NotificationProvidersModule } from '../notifications/providers/notification-providers.module';
import { StaffInvitationsModule } from '../staff-invitations/staff-invitations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '1d') },
      }),
    }),
    // Password recovery (Stage 2): scoped to AuthController's own public
    // routes only (forgot/reset-password), the same scoping pattern
    // SignupModule/OnboardingModule already use for their own
    // public/abuse-prone endpoints — not a global APP_GUARD.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 20 }]),
    // Password recovery (Stage 2): AuthService sends the reset email via
    // EMAIL_PROVIDER, the same token OnboardingService already injects
    // for staff invitation email.
    NotificationProvidersModule,
    // Staff Invitations stage: AuthController's accept-invite routes
    // delegate to StaffInvitationsService (a leaf module — no circular
    // dependency).
    StaffInvitationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
