import { BadRequestException, ConflictException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountTokenPurpose, Prisma, UserRole } from '@prisma/client';
import type { AuthenticatedUser, CustomerEntryPointResponse, JwtPayload, LoginResponseDto, LoginResult } from '@transatlantic/shared';
import { STAFF_ROLES } from '@transatlantic/shared';
import * as bcrypt from 'bcrypt';
import { generateCustomerNumber } from '../common/numbering/numbering.util';
import { generateToken, hashToken } from '../common/token/token.util';
import { isSharedAnanseLogixDomain, resolveTenantWebAppUrl } from '../common/tenant/tenant-web-app-url.util';
import { SMS_CONSENT_DISCLOSURE_VERSION } from '../notifications/sms-consent.constants';
import { MfaStageTokenService } from './mfa/mfa-stage-token.service';
import { passwordResetEmail } from '../notifications/templates/platform-emails';
import { resolvePlatformEmailSender } from '../notifications/providers/platform-email-sender.util';
import { EMAIL_PROVIDER } from '../notifications/providers/provider.types';
import type { EmailProvider } from '../notifications/providers/provider.types';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerSignupDto } from './dto/customer-signup.dto';

/** How long a forgot-password link stays valid — short by design; see AuthService.requestPasswordReset's own doc comment. */
const PASSWORD_RESET_TTL_MINUTES = 30;


@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mfaStageTokenService: MfaStageTokenService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * Email-based staff MFA (2026-10): a successful password match for a
   * STAFF_ROLES account (OWNER/MANAGER/STAFF/FINANCE — every present and
   * future tenant, no per-tenant configuration) no longer returns a
   * LoginResponseDto directly. It returns an MfaRequiredLoginResponse
   * instead — a short-lived `mfaToken` the client must exchange with
   * POST /auth/mfa/send (emails a 6-digit code) and then POST
   * /auth/mfa/challenge (verifies it) before ever receiving a real access
   * token. This is the single choke point that makes MFA automatic for
   * every tenant: nothing here reads tenantId, a tenant's own settings,
   * or any allow-list — only `role`. There is no separate "enrollment"
   * state (unlike the superseded TOTP design) — every login for a
   * STAFF_ROLES account goes through the same email-code step, including
   * the very first one. CUSTOMER and PLATFORM_ADMIN are unaffected and
   * keep today's exact one-step login.
   */
  async login(email: string, password: string): Promise<LoginResult> {
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

      if ((STAFF_ROLES as string[]).includes(user.role)) {
        return {
          mfaRequired: true,
          mfaToken: await this.mfaStageTokenService.issue(user.id, 'mfa_challenge'),
        };
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

  /**
   * Issues a real access token. Public (not private) because MfaService
   * calls this directly once a STAFF_ROLES caller's MFA step succeeds —
   * see that file's own doc comment. The only two ways to ever reach this
   * method for a STAFF_ROLES user are: this class's own `login` for a
   * role MFA doesn't apply to, or MfaService after a verified code —
   * never directly from a password-only check.
   */
  async buildLoginResponse(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    tenantId: string | null;
    customer: { id: string } | null;
    permissions: string[];
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
      // RBAC permissions (2026-10): see AuthenticatedUser.permissions —
      // re-read on every subsequent request by JwtStrategy regardless, but
      // the token issued right here should reflect the same fresh value.
      permissions: user.permissions,
    };

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: authenticatedUser.role,
      tenantId: user.tenantId,
      customerId: authenticatedUser.customerId,
      // Platform-wide staff MFA (2026-10): always true — reaching this
      // method at all already proves either MFA isn't required for this
      // role, or it was just satisfied. See JwtStrategy's own doc comment
      // for the per-request check this claim feeds.
      mfa: true,
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
   * talogisticssolutions.com/register — resolution falls back to the
   * config-driven LEGACY_CUSTOM_DOMAIN_TENANT_SLUG, the same single source
   * of truth every other legacy-grandfather special case in this codebase
   * already reads (see tenant-web-app-url.util.ts and
   * resolveCustomerEntryPoint below) — not a second hardcoded literal. Zero
   * behavior change for that path as long as that var stays set to
   * "transatlantic" in production, exactly as it already is today. If it
   * were ever unset, signup-with-no-slug fails with the same
   * BadRequestException below rather than guessing a tenant — correct,
   * since no other tenant is ever reached without an explicit slug anyway.
   */
  async customerSignup(dto: CustomerSignupDto): Promise<LoginResponseDto> {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const targetSlug = dto.tenantSlug?.trim() || this.configService.get<string>('LEGACY_CUSTOM_DOMAIN_TENANT_SLUG');
    const tenant = targetSlug
      ? await this.prisma.tenant.findFirst({ where: { slug: targetSlug, isActive: true } })
      : null;
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
      permissions: user.permissions,
    });
  }

  /**
   * The central AnanseLogix login (/ananselogix/login) is for tenant
   * staff and platform admins, not shipping customers — a CUSTOMER who
   * authenticates there must not silently land in /portal *as if this
   * were their tenant's own dedicated login page* (see that page's own
   * doc comment). This resolves whether their tenant has a real,
   * separate destination to hand off to, or whether — like every other
   * tenant sharing this platform's own ananselogix.com — they should
   * simply be signed in right here, the same as any other role.
   *
   * `user` is always sourced from a verified JWT (never a client-
   * supplied tenant ID), so this can only ever answer for the tenant
   * the caller actually authenticated into.
   *
   * Multi-tenant customer login fix (2026-09): previously hardcoded to
   * `slug === 'transatlantic'`, with every other tenant getting
   * `available: false` and a dead-end "sign in elsewhere" message —
   * written when `/portal` had no real, working multi-tenant home to
   * send anyone else to. That's no longer true: `/portal` (see
   * portal/layout.tsx's own useTenant()-driven branding) already
   * correctly resolves any tenant's own customer portal from the JWT
   * alone, with zero hostname or slug dependency. So the real question
   * this function answers is only "does this tenant have a *separate*
   * destination outside the shared platform" — exactly the same
   * isSharedAnanseLogixDomain check resolveTenantDropoffUrl and friends
   * already use, never a second hardcoded slug to keep in sync:
   *
   *   - `tenant.customDomain` set → that tenant's own real domain (not
   *     yet populated for any tenant today — the same forward-looking
   *     extension point tenant-web-app-url.util.ts already documents).
   *   - the one legacy-grandfathered tenant (config-driven via
   *     LEGACY_CUSTOM_DOMAIN_TENANT_SLUG, same as everywhere else this
   *     session touched) → its own hardcoded /login, byte-for-byte
   *     unchanged from before this fix.
   *   - every other tenant (Gold Coast, Titanic, any future tenant with
   *     no customDomain yet) → `available: true, url: null` — "no
   *     redirect, sign them in here" — a state this function never used
   *     to be able to express. The frontend (ananselogix/login's own
   *     CUSTOMER branch) treats this exactly like every other role:
   *     store the session, go to /portal.
   */
  async resolveCustomerEntryPoint(user: AuthenticatedUser): Promise<CustomerEntryPointResponse> {
    if (!user.tenantId) return { available: false, url: null };

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { slug: true, customDomain: true, isActive: true },
    });
    if (!tenant || !tenant.isActive) return { available: false, url: null };

    if (isSharedAnanseLogixDomain(tenant, this.configService)) {
      return { available: true, url: null };
    }

    if (tenant.customDomain) {
      return { available: true, url: `https://${tenant.customDomain}/login` };
    }
    // The legacy-grandfathered tenant — isSharedAnanseLogixDomain already
    // confirmed customDomain is unset and the slug matches, so this is
    // always Trans Atlantic today. Unchanged from before this fix.
    return { available: true, url: '/login' };
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
      include: { tenant: { select: { slug: true, customDomain: true } } },
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

        // Multi-tenant hostname fix (2026-10): reset links must resolve
        // to the SAME tenant-aware host staff-invitation links already
        // use (resolveTenantWebAppUrl) — not the global WEB_APP_URL,
        // which only ever means Trans Atlantic's own legacy domain (see
        // that util's own doc comment for the full precedence rules).
        // Using WEB_APP_URL unconditionally here would have sent every
        // other tenant's (and every future tenant's) reset link to Trans
        // Atlantic's hostname. A PLATFORM_ADMIN (tenantId null, no tenant
        // row at all) falls through to the platform's own hostname —
        // resolveTenantWebAppUrl's own legacy-slug branch can never match
        // a null tenant, so this is safe without a special case here.
        const webAppUrl = user.tenant
          ? resolveTenantWebAppUrl(user.tenant, this.configService)
          : this.configService.get<string>('ANANSELOGIX_BASE_URL', 'http://localhost:3000')!;
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
