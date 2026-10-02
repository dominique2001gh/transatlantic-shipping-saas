import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { AuthenticatedUser, JwtPayload } from '@transatlantic/shared';
import { STAFF_ROLES } from '@transatlantic/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Runs on every authenticated request. Re-checks the user against the
   * database (rather than trusting the JWT payload alone) so a
   * deactivated user or deleted tenant is rejected immediately instead of
   * waiting for the token to expire.
   *
   * Password recovery (Stage 2): also rejects any token issued *before*
   * the user's last password change/reset (`payload.iat`, seconds, vs.
   * `passwordChangedAt`, a Date) — this is what actually invalidates
   * every already-issued JWT the moment a password is changed or reset,
   * without needing a token blacklist/session table, by reusing the same
   * per-request DB check this method already does for isActive/tenant.
   * `passwordChangedAt` starts null for every account that predates this
   * feature (every existing seeded/production user), and null never
   * counts as "later than" a token's iat, so no currently-valid session
   * is affected until that account's password is actually changed for
   * the first time.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { customer: { select: { id: true } } },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Both sides compared in whole seconds (floor), not milliseconds:
    // `iat` is a JWT-standard Unix timestamp truncated to the second at
    // sign time, so a token issued the *same* second as the password
    // change must not be treated as "before" it — that's not a real
    // stale-session case, just second-level rounding, and comparing at
    // millisecond precision would reject a token issued moments after a
    // reset purely by truncation bad luck.
    if (user.passwordChangedAt && payload.iat && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      throw new UnauthorizedException('Session invalidated by a password change — please log in again');
    }

    if (user.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
      if (!tenant || !tenant.isActive) {
        throw new UnauthorizedException('Tenant account is not active');
      }
    }

    /**
     * Email-based staff MFA (2026-10): the single backend enforcement
     * point for every protected route, for every tenant, present and
     * future — no per-route guard, no per-tenant setting. `payload.mfa`
     * is only ever `true` on a token AuthService.buildLoginResponse
     * issued (see that method's own doc comment), which for a
     * STAFF_ROLES role only ever happens after a successful emailed-code
     * challenge (MfaService.verifyOtp). Any other token presented for a
     * STAFF_ROLES user — one issued before this feature existed, or any
     * attempt to reuse a password-only state — is rejected exactly like
     * an expired/deactivated session: a 401 that forces the client back
     * through POST /auth/login, which always routes a STAFF_ROLES account
     * into the email-code step; there is no separate enrollment state to
     * route around. This check is keyed purely on `role`, never on
     * `tenantId`, so it applies identically to Trans Atlantic, Tatanic,
     * and any tenant created after this shipped.
     */
    if ((STAFF_ROLES as string[]).includes(user.role) && payload.mfa !== true) {
      throw new UnauthorizedException('Session has not completed MFA — please log in again');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as AuthenticatedUser['role'],
      tenantId: user.tenantId,
      customerId: user.customer?.id ?? null,
    };
  }
}
