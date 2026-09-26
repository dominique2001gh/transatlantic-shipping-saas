import { Controller, Get, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser, TenantStripeConnectStatus } from '@transatlantic/shared';
import { OWNER_ONLY_ROLES } from '@transatlantic/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../common/decorators/require-entitlement.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { requireTenantId } from '../common/tenant/tenant.util';
import { resolveTenantWebAppUrl } from '../common/tenant/tenant-web-app-url.util';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPaymentsStripeService } from './tenant-payments-stripe.service';

/**
 * Tenant Payments Phase 2: the OWNER-only HTTP surface for connecting a
 * tenant's own Stripe (Express, Account-Links-onboarded) account — see
 * TenantPaymentSettings's own schema doc comment for the full approved
 * architecture. `@RequireEntitlement(OPERATIONS_SOFTWARE)` matches
 * PaymentsController's own existing gate (same tenant-operations
 * surface); deliberately not yet gated behind any SaaS plan tier — that
 * is separate, unrelated plan-entitlement work.
 *
 * Every route here reads tenantId exclusively from the verified JWT
 * (`requireTenantId(user.tenantId)`), never from a request param/body —
 * there is no way for this controller to act on any tenant other than
 * the caller's own, by construction, the same posture every other
 * tenant-scoped controller in this codebase already follows.
 */
@Controller('tenant-payments/connect')
@RequireEntitlement(EntitlementFeature.OPERATIONS_SOFTWARE)
export class TenantPaymentsController {
  constructor(
    private readonly tenantPaymentsStripeService: TenantPaymentsStripeService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Starts or resumes Stripe onboarding for the caller's own tenant.
   * getOrCreateConnectedAccount's own doc comment covers why a repeated
   * call here can never create a second connected account. refresh_url
   * (Stripe redirects here if the staged Account Link itself expires
   * mid-flow — the user is expected to just request a fresh one, not
   * that anything failed) and return_url (Stripe redirects here once the
   * hosted flow is complete, successfully or not — onboarding status is
   * only ever actually confirmed by the account.updated webhook, never
   * inferred from the browser simply landing back on this URL) both point
   * at Settings → Payments (Tenant Payment Configuration Phase B) — that
   * page reads its own `?stripeConnect=refresh|return` query param only to
   * decide whether to show a transient "check back in a moment" notice
   * while re-polling GET /tenant-payments/connect/status; it never treats
   * the redirect itself as proof of anything.
   */
  @Post('onboarding-link')
  @Roles(...OWNER_ONLY_ROLES)
  async createOnboardingLink(@CurrentUser() user: AuthenticatedUser): Promise<{ url: string }> {
    const tenantId = requireTenantId(user.tenantId);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true, customDomain: true, email: true } });
    const webAppUrl = resolveTenantWebAppUrl(tenant, this.config);

    const accountId = await this.tenantPaymentsStripeService.getOrCreateConnectedAccount(tenantId, tenant.email);
    const url = await this.tenantPaymentsStripeService.createOnboardingLink({
      accountId,
      refreshUrl: `${webAppUrl.replace(/\/$/, '')}/dashboard/settings/payments?stripeConnect=refresh`,
      returnUrl: `${webAppUrl.replace(/\/$/, '')}/dashboard/settings/payments?stripeConnect=return`,
    });

    return { url };
  }

  /** Current connection state for the caller's own tenant only — see TenantPaymentsStripeService.getConnectionStatus's own doc comment (pure DB read, never a live Stripe API call). */
  @Get('status')
  @Roles(...OWNER_ONLY_ROLES)
  getStatus(@CurrentUser() user: AuthenticatedUser): Promise<TenantStripeConnectStatus> {
    return this.tenantPaymentsStripeService.getConnectionStatus(requireTenantId(user.tenantId));
  }
}
