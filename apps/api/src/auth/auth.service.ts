import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedUser, CustomerEntryPointResponse, JwtPayload, LoginResponseDto } from '@transatlantic/shared';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const normalizedEmail = email.toLowerCase().trim();

    // email is unique per tenant, not globally (Stage 2C: the same person
    // may hold independent customer-portal accounts at more than one
    // tenant with the same email). The login form only collects
    // email+password, so every account with this email is a candidate —
    // whichever one's password matches (and whose tenant, if any, is
    // active) is the account that gets logged into. In the overwhelmingly
    // common case (one account per email) this is exactly one candidate,
    // so behavior is unchanged from before.
    const candidates = await this.prisma.user.findMany({
      where: { email: normalizedEmail },
      include: { customer: { select: { id: true } } },
    });

    let tenantInactiveMatch: (typeof candidates)[number] | null = null;

    for (const user of candidates) {
      if (!user.isActive) continue;

      const passwordMatches = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatches) continue;

      if (user.tenantId) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
        if (!tenant || !tenant.isActive) {
          tenantInactiveMatch = user;
          continue;
        }
      }

      return this.buildLoginResponse(user);
    }

    // Same error for "no such user" and "wrong password" — don't leak
    // which one it was. A tenant-inactive match (correct password, but the
    // organization itself is deactivated) gets its own specific message,
    // matching the pre-Stage-2C single-account behavior.
    if (tenantInactiveMatch) {
      throw new UnauthorizedException("This account's organization is not active");
    }
    throw new UnauthorizedException('Invalid email or password');
  }

  private async buildLoginResponse(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    tenantId: string | null;
    customer: { id: string } | null;
  }): Promise<LoginResponseDto> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role as AuthenticatedUser['role'],
      tenantId: user.tenantId,
      customerId: user.customer?.id ?? null,
    };

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: authenticatedUser.role,
      tenantId: user.tenantId,
      customerId: authenticatedUser.customerId,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '1d'),
      }),
      user: authenticatedUser,
    };
  }

  static async hashPassword(plainTextPassword: string, saltRounds = 10): Promise<string> {
    return bcrypt.hash(plainTextPassword, saltRounds);
  }

  /**
   * The central AnanseLogix login (/ananselogix/login) is for tenant
   * staff and platform admins, not shipping customers — a CUSTOMER who
   * authenticates there must not land in /portal from that entry point
   * (see that page's own doc comment). This resolves where their
   * tenant's *own* branded customer login lives instead, so the
   * frontend can redirect there or fall back to a generic message.
   *
   * `user` is always sourced from a verified JWT (never a client-
   * supplied tenant ID), so this can only ever answer for the tenant
   * the caller actually authenticated into.
   *
   * Trans Atlantic (tenant #1) is the only tenant with a real, working
   * local entry point today — its login page is the hardcoded
   * apps/web/src/lib/site-config.ts-branded /login, not anything driven
   * by Tenant table data. Every other tenant's `customDomain` is, per
   * its own schema comment, "reserved for a future real domain cutover
   * — deliberately unused by any routing/DNS/deployment logic today,"
   * so there is no real, live URL to send them to yet; those tenants
   * get `available: false` and the frontend shows a generic message
   * instead of a link to a page that doesn't actually exist. Once
   * per-tenant domains are wired up, this is the one place that swaps
   * from the `slug === 'transatlantic'` special case to reading
   * `tenant.customDomain`.
   */
  async resolveCustomerEntryPoint(user: AuthenticatedUser): Promise<CustomerEntryPointResponse> {
    if (!user.tenantId) return { available: false, url: null };

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { slug: true },
    });
    if (!tenant) return { available: false, url: null };

    if (tenant.slug === 'transatlantic') {
      return { available: true, url: '/login' };
    }
    return { available: false, url: null };
  }

  /**
   * Stage 3I: self-service password change for any authenticated User
   * (staff or CUSTOMER) — always changes the caller's own account.
   * `userId` must be sourced from the caller's verified JWT (see
   * UsersController.changePassword), never from a request body/param, so
   * there is no way to target another account. Requires the correct
   * current password before accepting a new one — the same bcrypt
   * comparison `login` already uses — and rejects a "new" password
   * identical to the current one rather than silently no-opping.
   *
   * A wrong `currentPassword` is a 400 (BadRequestException), not a 401
   * (UnauthorizedException) — deliberately. The caller's JWT/session is
   * already fully valid at this point (JwtAuthGuard already accepted it);
   * only the *submitted current-password value* is wrong, exactly the
   * same category of "authenticated but bad input" as the
   * newPassword===currentPassword check right below. The web client's
   * apiFetch treats *any* 401 on a token-bearing request as "the session
   * itself is bad" and force-logs-out — correct for every route where a
   * 401 really can only come from the guard rejecting the token, but
   * this handler is the one place a 401 could instead mean "wrong current
   * password," which apiFetch has no way to distinguish. Using 400 here
   * keeps 401 reserved for genuine session/token invalidity everywhere in
   * the app, so a wrong current password reports its own error in place
   * (see PasswordSection in apps/web) instead of logging the customer out.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) {
      // Should never happen — userId comes from a JWT that JwtStrategy
      // already re-validated against an active user this same request.
      // Genuinely a session problem if it ever fires, so this one stays 401.
      throw new UnauthorizedException('Invalid or expired session');
    }

    const currentMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (newPassword === currentPassword) {
      throw new BadRequestException('New password must be different from your current password');
    }

    const passwordHash = await AuthService.hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }
}
