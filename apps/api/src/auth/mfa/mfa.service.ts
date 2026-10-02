import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import * as bcrypt from 'bcrypt';
import type { LoginResponseDto, MfaSetupResponse, MfaStatusResponse } from '@transatlantic/shared';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { hashToken } from '../../common/token/token.util';
import { decryptMfaSecret, encryptMfaSecret } from './mfa-crypto.util';
import { generateRecoveryCodes, normalizeRecoveryCode } from './mfa-recovery-codes.util';

/** The issuer label shown inside every authenticator app, next to the account name — deliberately the platform's own name, never a tenant's, so this stays identical for every present and future tenant. */
const MFA_ISSUER = 'AnanseLogix';

/** TTL for the signed "pending new secret" token a factor-replace flow carries between its two steps — see MfaService.beginFactorReplace. */
const FACTOR_REPLACE_TOKEN_TTL = '10m';

interface FactorReplacePayload {
  sub: string;
  purpose: 'mfa_replace';
  newSecret: string;
}

/**
 * Platform-wide staff MFA (2026-10): all TOTP enrollment/challenge/
 * factor-management logic lives here — one service, reused by both the
 * pre-session routes (MfaController, gated by MfaStageGuard) and the
 * authenticated self-service routes (UsersController, gated by the
 * normal JwtAuthGuard/RolesGuard like everything else). Nothing in this
 * file ever reads or branches on `tenantId` — enrollment/verification is
 * purely a property of a `User` row, which is exactly what makes this
 * automatic for every tenant without per-tenant configuration.
 *
 * CUSTOMER/PLATFORM_ADMIN are out of scope by construction: nothing here
 * is reachable for those roles because AuthService.login never issues a
 * stage token for them in the first place (see that method's own doc
 * comment) — this service has no role check of its own to keep in sync.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  /**
   * First step of enrollment. Always generates a brand-new secret
   * (never reuses a half-finished prior attempt) and writes it to
   * `User.mfaSecret` immediately — safe to do before verification
   * because `mfaEnabled` stays `false` until `verifySetup` succeeds, and
   * JwtStrategy's enforcement check is keyed on `mfaEnabled`/the `mfa`
   * session claim, never on whether `mfaSecret` happens to be non-null.
   * A user who abandons enrollment mid-way and calls this again simply
   * gets a fresh secret; the old, never-activated one is just overwritten.
   */
  async beginSetup(userId: string): Promise<MfaSetupResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Defense in depth: a `mfa_setup`-stage token is only ever issued by
    // AuthService.login for an account that was NOT enrolled at that
    // instant (see that method's own doc comment). If the account somehow
    // became enrolled since (a second concurrent enrollment, or an old
    // still-unexpired stage token reused after enrolling through another
    // one) this must not silently replace the active factor out from
    // under the user — factor replacement has its own password-protected
    // flow (beginFactorReplace) for exactly that reason.
    if (user.mfaEnabled) {
      throw new ForbiddenException('MFA is already enrolled for this account — use factor replacement instead.');
    }
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptMfaSecret(this.configService, secret) },
    });
    return { secret, otpauthUri: authenticator.keyuri(user.email, MFA_ISSUER, secret) };
  }

  /** Second step of enrollment — activates MFA and issues the real session. */
  async verifySetup(userId: string, code: string): Promise<LoginResponseDto & { recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { customer: { select: { id: true } } } });
    if (!user.mfaSecret) {
      throw new BadRequestException('No MFA enrollment in progress — call /auth/mfa/setup first');
    }
    const secret = decryptMfaSecret(this.configService, user.mfaSecret);
    if (!authenticator.verify({ token: code, secret })) {
      throw new UnauthorizedException('Invalid verification code');
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true, mfaEnrolledAt: new Date() } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((code) => ({ userId, codeHash: hashToken(code) })),
      }),
    ]);

    const loginResponse = await this.authService.buildLoginResponse(user);
    return { ...loginResponse, recoveryCodes };
  }

  /**
   * Login-time challenge for an already-enrolled account. Accepts either
   * a TOTP code or a recovery code — never both, never neither (DTO-level
   * fields are both optional; this is the one place that enforces
   * "exactly one").
   */
  async challenge(userId: string, code?: string, recoveryCode?: string): Promise<LoginResponseDto> {
    if (!code && !recoveryCode) {
      throw new BadRequestException('Provide either a 6-digit code or a recovery code');
    }
    if (code && recoveryCode) {
      throw new BadRequestException('Provide either a code or a recovery code, not both');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { customer: { select: { id: true } } } });
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new ForbiddenException('MFA is not enrolled for this account');
    }

    if (code) {
      const secret = decryptMfaSecret(this.configService, user.mfaSecret);
      if (!authenticator.verify({ token: code, secret })) {
        throw new UnauthorizedException('Invalid verification code');
      }
    } else {
      await this.consumeRecoveryCode(userId, recoveryCode!);
    }

    return this.authService.buildLoginResponse(user);
  }

  private async consumeRecoveryCode(userId: string, rawCode: string): Promise<void> {
    const codeHash = hashToken(normalizeRecoveryCode(rawCode));
    const recoveryCode = await this.prisma.mfaRecoveryCode.findFirst({ where: { userId, codeHash, usedAt: null } });
    if (!recoveryCode) {
      throw new UnauthorizedException('Invalid or already-used recovery code');
    }
    await this.prisma.mfaRecoveryCode.update({ where: { id: recoveryCode.id }, data: { usedAt: new Date() } });
  }

  async status(userId: string): Promise<MfaStatusResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabled: true, mfaEnrolledAt: true } });
    return { enabled: user.mfaEnabled, enrolledAt: user.mfaEnrolledAt?.toISOString() ?? null };
  }

  /**
   * Factor replacement, step 1 — requires the caller's current password
   * (the "recent authentication" check requirement 8 calls for; a staff
   * session has no concept of "recently verified MFA" to re-check instead,
   * so password re-entry is the available equivalent). The new secret is
   * carried ONLY inside a short-lived signed token, never written to
   * `User.mfaSecret` yet — so an abandoned replace can never leave the
   * account's active factor in an ambiguous state, and a replace that is
   * never verified has zero effect on the existing, still-working factor.
   */
  async beginFactorReplace(userId: string, currentPassword: string): Promise<MfaSetupResponse & { replaceToken: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newSecret = authenticator.generateSecret();
    const payload: FactorReplacePayload = { sub: userId, purpose: 'mfa_replace', newSecret };
    const replaceToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: FACTOR_REPLACE_TOKEN_TTL,
    });

    return {
      secret: newSecret,
      otpauthUri: authenticator.keyuri(user.email, MFA_ISSUER, newSecret),
      replaceToken,
    };
  }

  /** Factor replacement, step 2 — only now does the new secret ever reach `User.mfaSecret`, atomically replacing the old one and every old recovery code. */
  async completeFactorReplace(userId: string, replaceToken: string, code: string): Promise<{ recoveryCodes: string[] }> {
    let payload: FactorReplacePayload;
    try {
      payload = await this.jwtService.verifyAsync<FactorReplacePayload>(replaceToken, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('This factor-replacement request has expired — start again');
    }
    if (payload.purpose !== 'mfa_replace' || payload.sub !== userId) {
      throw new UnauthorizedException('Invalid factor-replacement token');
    }
    if (!authenticator.verify({ token: code, secret: payload.newSecret })) {
      throw new UnauthorizedException('Invalid verification code');
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaSecret: encryptMfaSecret(this.configService, payload.newSecret), mfaEnrolledAt: new Date() },
      }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((code) => ({ userId, codeHash: hashToken(code) })),
      }),
    ]);

    return { recoveryCodes };
  }

  /**
   * Break-glass recovery — the only way to clear MFA enrollment when a
   * user has lost both their device and every recovery code. Deliberately
   * NOT exposed to any tenant-level role (not even OWNER over their own
   * MANAGER/STAFF/FINANCE) — see MfaController's own doc comment for why
   * this is PLATFORM_ADMIN-only and always audit-logged. Forces the
   * target user through fresh enrollment on their very next login; never
   * grants access itself.
   */
  async adminResetForRecovery(platformAdminUserId: string, targetUserId: string): Promise<void> {
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { mfaEnabled: false, mfaSecret: null, mfaEnrolledAt: null },
      }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: targetUserId } }),
      this.prisma.platformAuditLog.create({
        data: {
          platformAdminUserId,
          action: 'MFA_RESET_FOR_RECOVERY',
          targetTenantId: target.tenantId,
          metadata: { targetUserId },
        },
      }),
    ]);
  }
}
