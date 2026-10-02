import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import type { LoginResponseDto } from '@transatlantic/shared';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { hashToken } from '../../common/token/token.util';
import { mfaOtpEmail } from '../../notifications/templates/platform-emails';
import { resolvePlatformEmailSender } from '../../notifications/providers/platform-email-sender.util';
import { EMAIL_PROVIDER } from '../../notifications/providers/provider.types';
import type { EmailProvider } from '../../notifications/providers/provider.types';
import { lastOtpCodeByUserId, otpTestHookEnabled } from './mfa-otp-test-hook';

/** How long an emailed code stays valid — long enough to allow for email delivery delay, short enough to keep the exposure window tight. */
const OTP_TTL_MINUTES = 10;

/** Minimum time between two codes being issued to the same user — blocks an email-flooding resend loop; see requestOtp. */
const RESEND_COOLDOWN_SECONDS = 30;

/** Wrong-code attempts allowed against a single issued code before it's invalidated and a fresh one is required — see verifyOtp. */
const MAX_VERIFY_ATTEMPTS = 5;

/**
 * Email-based staff MFA (2026-10): every OWNER/MANAGER/STAFF/FINANCE
 * login (every present and future tenant, no per-tenant configuration)
 * is completed with a 6-digit code emailed to that account's own
 * registered address — the platform's existing email infrastructure
 * (EMAIL_PROVIDER) is the sole delivery channel; there is no SMS/Twilio
 * and no authenticator-app path. Nothing in this file ever reads or
 * branches on `tenantId` — same reasoning as the superseded TOTP design
 * this replaced (see User.mfaEnabled's own doc comment in schema.prisma).
 *
 * CUSTOMER/PLATFORM_ADMIN are out of scope by construction: AuthService.
 * login never issues a stage token for them, so nothing here is ever
 * reachable for those roles.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * Generates a fresh 6-digit code, invalidates whatever code (if any)
   * was previously outstanding for this user, and emails the new one.
   * Called both for the very first code of a login attempt and for an
   * explicit resend — there is no separate "enrollment" step with email
   * OTP, so every call does the exact same thing.
   */
  async requestOtp(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    // Only an OUTSTANDING (unconsumed) code triggers the cooldown — a
    // fresh login shortly after a previous one that was already
    // completed (or expired/invalidated) has nothing live to protect and
    // must not be blocked just because the user signed in again quickly.
    const outstanding = await this.prisma.mfaEmailOtp.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (outstanding && outstanding.createdAt.getTime() > Date.now() - RESEND_COOLDOWN_SECONDS * 1000) {
      throw new BadRequestException(`Please wait a moment before requesting another code.`);
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await this.prisma.$transaction([
      // Only one outstanding code per user at a time — an old, unconsumed
      // code becomes unusable the moment a new one is issued.
      this.prisma.mfaEmailOtp.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.mfaEmailOtp.create({
        data: { userId, codeHash: hashToken(code), expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000) },
      }),
    ]);

    if (otpTestHookEnabled) {
      lastOtpCodeByUserId.set(userId, code);
    }

    const email = mfaOtpEmail({ firstName: user.firstName, code, expiresInMinutes: OTP_TTL_MINUTES });
    await this.emailProvider.send({
      to: user.email,
      subject: email.subject,
      body: email.body,
      ...resolvePlatformEmailSender(this.configService),
    });
  }

  /** Verifies the code entered at login and, on success, issues the real session. */
  async verifyOtp(userId: string, code: string): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { customer: { select: { id: true } } } });

    const otp = await this.prisma.mfaEmailOtp.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new ForbiddenException('No active verification code — request a new one');
    }
    if (otp.expiresAt < new Date()) {
      await this.prisma.mfaEmailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      throw new UnauthorizedException('This code has expired — request a new one');
    }
    if (otp.attempts >= MAX_VERIFY_ATTEMPTS) {
      await this.prisma.mfaEmailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      throw new UnauthorizedException('Too many incorrect attempts — request a new code');
    }

    if (hashToken(code) !== otp.codeHash) {
      await this.prisma.mfaEmailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.prisma.mfaEmailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    return this.authService.buildLoginResponse(user);
  }
}
