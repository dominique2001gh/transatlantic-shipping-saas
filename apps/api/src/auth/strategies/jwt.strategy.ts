import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { AuthenticatedUser, JwtPayload } from '@transatlantic/shared';
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
