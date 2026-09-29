import { BadRequestException, ConflictException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountTokenPurpose, Prisma, UserRole } from '@prisma/client';
import type { AuthenticatedUser, CustomerEntryPointResponse, JwtPayload, LoginResponseDto } from '@transatlantic/shared';
import * as bcrypt from 'bcrypt';
import { generateCustomerNumber } from '../common/numbering/numbering.util';
import { generateToken, hashToken } from '../common/token/token.util';
import { SMS_CONSENT_DISCLOSURE_VERSION } from '../notifications/sms-consent.constants';
import { passwordResetEmail } from '../notifications/templates/platform-emails';
import { resolvePlatformEmailSender } from '../notifications/providers/platform-email-sender.util';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.types';
import type { EmailProvider } from '../notifications/providers/provider.types';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerSignupDto } from './dto/customer-signup.dto';

/** How long a forgot-password link stays valid — short by design; see AuthService.requestPasswordReset's own doc comment. */
const PASSWORD_RESET_TTL_MINUTES = 30;

/**
 * Customer Self-Service Pre-Registration, Stage 2: the one tenant with a
 * real, working customer-portal entry point today — same hardcoded slug
 * already used by resolveCustomerEntryPoint below. See customerSignup's
 * own doc comment for why this is intentionally not a client-supplied
 * value.
 */
const TRANS_ATLANTIC_TENANT_SLUG = 'transatlantic';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
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
   * Customer Self-Service Pre-Registration, Stage 2: the smallest safe
   * first-time-customer signup path. Stage 1's own audit found there was
   * previously no production way for a customer to obtain portal
   * credentials at all — this closes that gap without inventing a second
   * authentication system: it creates a normal CUSTOMER-role `User` and
   * reuses `buildLoginResponse` to issue the exact same JWT shape `login`
   * does, so every existing guard/decorator downstream (JwtStrategy,
   * RolesGuard, requireTenantId/requireCustomerId) needs zero changes to
   * recognize the resulting session.
   *
   * Multi-tenant Drop-Off: tenant resolution is by `dto.tenantSlug` when the
   * caller supplies one — carried through from the tenant-specific
   * /dropoff/{tenantSlug} public link (see resolveTenantDropoffUrl's own
   * doc comment for how that URL is generated, and
   * apps/web/src/app/(public)/dropoff/[tenantSlug]/page.tsx for how it's
   * threaded to this call). `tenantSlug` is a caller-supplied *lookup key*,
   * never trusted as an authorization decision by itself: it only selects
   * which tenant's `findFirst({ slug, isActive: true })` row this signup
   * attaches to — every check below it (existing-user, existing-customer,
   * the User(tenantId, email) unique constraint) is already scoped to
   * whatever tenant.id that lookup resolved, exactly as before, so a
   * mistaken or malicious slug can at most land the signup on a *different
   * real, active* tenant — never leak or modify another tenant's existing
   * account, and never create anything above a CUSTOMER-role account (no
   * `role` field exists on CustomerSignupDto for a caller to set even if it
   * tried — the global ValidationPipe's forbidNonWhitelisted config rejects
   * it outright, and this method's own Prisma call hardcodes `role:
   * UserRole.CUSTOMER` unconditionally).
   *
   * When `dto.tenantSlug` is omitted — every existing caller of this
   * endpoint today, e.g. Trans Atlantic's own /register reached directly at
   * talogisticssolutions.com/register — resolution falls back to
   * TRANS_ATLANTIC_TENANT_SLUG exactly as before this change. Zero behavior
   * change for that path.
   */
  async customerSignup(dto: CustomerSignupDto): Promise<LoginResponseDto> {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const targetSlug = dto.tenantSlug?.trim() || TRANS_ATLANTIC_TENANT_SLUG;
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug: targetSlug, isActive: true },
    });
    if (!tenant) {
      throw new BadRequestException('Customer sign-up is not available right now.');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: normalizedEmail } },
    });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists. Please sign in instead.');
    }

    // A Customer row may already exist for this email/tenant from
    // staff-side shipment history (e.g. New Shipment/Quick Receive created
    // it before this person ever had a portal login) — link the new
    // account to that existing record instead of creating a duplicate, so
    // their shipment history is preserved rather than orphaned under a
    // second, disconnected Customer row. A Customer already linked to a
    // User here would mean its User.email no longer matches this email
    // (the existingUser check above would otherwise have caught it) —
    // rejected rather than silently re-linking someone else's account.
    const existingCustomer = await this.prisma.customer.findFirst({
      where: { tenantId: tenant.id, email: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    if (existingCustomer?.userId) {
      throw new ConflictException('An account with this email already exists. Please sign in instead.');
    }

    const passwordHash = await AuthService.hashPassword(dto.password);
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const phone = dto.phone?.trim() || undefined;

    /**
     * SMS/Twilio A2P Phase 1: the checkbox is the only thing that can ever
     * set these — left unchecked/omitted, every field here stays at its
     * schema default (false/null), never inferred from anything else.
     * Deliberately sets `notifyBySms` too (not just the consent fields):
     * the disclosure text IS the "I want SMS" ask, so checking it is both
     * the affirmative consent and the send-time opt-in in one action —
     * but the two stay separately recorded (see Customer.smsConsentGiven's
     * own doc comment) so `notifyBySms` alone is never later read back as
     * proof of consent.
     */
    const smsConsentData = dto.smsConsent
      ? {
          notifyBySms: true,
          smsConsentGiven: true,
          smsConsentAt: new Date(),
          smsConsentSource: 'register_web_form',
          smsConsentVersion: SMS_CONSENT_DISCLOSURE_VERSION,
        }
      : {};

    let user;
    let customerId: string;
    try {
      user = await this.prisma.user.create({
        data: { tenantId: tenant.id, email: normalizedEmail, passwordHash, firstName, lastName, role: UserRole.CUSTOMER },
      });

      if (existingCustomer) {
        await this.prisma.customer.update({
          where: { id: existingCustomer.id },
          data: { userId: user.id, phone: existingCustomer.phone ?? phone, ...smsConsentData },
        });
        customerId = existingCustomer.id;
      } else {
        const customerNumber = await generateCustomerNumber(this.prisma, tenant.id);
        const customer = await this.prisma.customer.create({
          data: { tenantId: tenant.id, customerNumber, firstName, lastName, email: dto.email.trim(), phone, userId: user.id, ...smsConsentData },
        });
        customerId = customer.id;
      }
    } catch (err) {
      // Concurrency backstop: two signups racing on the same email both
      // pass the findUnique check above before either commits — the
      // User(tenantId, email) unique constraint is the real guarantee,
      // this just turns that DB-level conflict into the same friendly
      // message as the check above, instead of a raw 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email already exists. Please sign in instead.');
      }
      throw err;
    }

    return this.buildLoginResponse({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      tenantId: user.tenantId,
      customer: { id: customerId },
    });
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
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date() } });
  }

  /**
   * Forgot-password (Stage 2). Deliberately returns void, never a status
   * the caller could branch on — AuthController.forgotPassword always
   * responds with the same generic message regardless of what happens in
   * here, so a mistyped email and a real one are indistinguishable from
   * the outside (Do not reveal whether an email exists in the system).
   *
   * Email is unique per tenant, not globally (see `login`'s own comment) —
   * every *active* account matching this email gets its own token and its
   * own email, so a person holding accounts at two different tenants with
   * the same address can reset either independently, and resetting one
   * never touches the other. Inactive accounts are silently skipped (no
   * token issued) rather than allowing a deactivated account back in
   * through this door.
   *
   * Every failure (email send, anything) is caught and logged, never
   * thrown — a transient provider outage must not turn into a response
   * shape that leaks account existence, and must not block the generic
   * "we sent it" response the controller always gives.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    const users = await this.prisma.user.findMany({
      where: { email: normalizedEmail, isActive: true },
    });

    for (const user of users) {
      try {
        const rawToken = generateToken();
        await this.prisma.accountToken.create({
          data: {
            userId: user.id,
            purpose: AccountTokenPurpose.PASSWORD_RESET,
            tokenHash: hashToken(rawToken),
            expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
          },
        });

        const webAppUrl = this.configService.get<string>('WEB_APP_URL', 'http://localhost:3000');
        const resetEmail = passwordResetEmail({
          firstName: user.firstName,
          resetUrl: `${webAppUrl.replace(/\/$/, '')}/reset-password?token=${rawToken}`,
          expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
        });
        await this.emailProvider.send({
          to: user.email,
          subject: resetEmail.subject,
          body: resetEmail.body,
          ...resolvePlatformEmailSender(this.configService),
        });
      } catch (err) {
        this.logger.error(`Failed to issue/send password reset for user ${user.id}: ${err}`);
      }
    }
  }

  /**
   * Consumes a forgot-password token: validates it (exists, right
   * purpose, unused, unexpired), then updates the password and marks the
   * token used in one transaction so a token can never be raced into
   * resetting a password twice. `passwordChangedAt` is set here for the
   * exact same reason `changePassword` above sets it — see JwtStrategy's
   * own doc comment for how that invalidates every JWT issued before now.
   *
   * The three failure cases (unknown/already-used/expired) get distinct
   * messages — unlike the email-existence question forgot-password must
   * never answer, possessing *this* token already proves the caller
   * received the email, so telling them their link specifically expired
   * (vs. is simply invalid) leaks nothing new.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const accountToken = await this.prisma.accountToken.findUnique({ where: { tokenHash } });

    if (!accountToken || accountToken.purpose !== AccountTokenPurpose.PASSWORD_RESET || accountToken.usedAt) {
      throw new BadRequestException('This reset link is invalid or has already been used');
    }
    if (accountToken.expiresAt < new Date()) {
      throw new BadRequestException('This reset link has expired — please request a new one');
    }

    const passwordHash = await AuthService.hashPassword(newPassword);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: accountToken.userId }, data: { passwordHash, passwordChangedAt: now } }),
      this.prisma.accountToken.update({ where: { id: accountToken.id }, data: { usedAt: now } }),
    ]);
  }
}
