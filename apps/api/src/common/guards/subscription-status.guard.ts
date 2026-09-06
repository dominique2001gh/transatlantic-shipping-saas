import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ALLOW_WHEN_SUSPENDED_KEY } from '../decorators/allow-when-suspended.decorator';

/**
 * AnanseLogix Phase 1: enforces the billing-status access rule from
 * Section 9 of the build brief — "Active -> Past Due -> Grace Period ->
 * Restricted/Suspended", with the owner retaining enough access during
 * suspension to manage billing (see @AllowWhenSuspended's own doc
 * comment for the explicit allowlist). Registered globally (APP_GUARD,
 * after JwtAuthGuard/RolesGuard in app.module.ts) so every tenant-scoped
 * route is covered by default — the same "secure/restricted by default,
 * opt out explicitly" posture JwtAuthGuard's own doc comment establishes
 * for authentication.
 *
 * A tenant with no TenantSubscription row at all is never restricted —
 * see EntitlementsGuard's own doc comment for the same "predates this
 * SaaS layer" reasoning. PLATFORM_ADMIN (tenantId null) is exempt too;
 * this guard is about *a tenant's own* billing standing, never about the
 * platform admin's ability to manage tenants (that stays governed purely
 * by RolesGuard).
 */
@Injectable()
export class SubscriptionStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user?.tenantId) {
      return true;
    }

    const subscription = await this.prisma.tenantSubscription.findUnique({ where: { tenantId: user.tenantId } });
    if (!subscription) {
      return true;
    }

    const isSuspended = await this.resolveIsSuspended(subscription);
    if (!isSuspended) {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_SUSPENDED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return true;
    }

    throw new ForbiddenException('Your subscription is suspended. Please update billing to restore access.');
  }

  /**
   * A PAST_DUE subscription past its own grace-period deadline is lazily
   * flipped to SUSPENDED here (and persisted) rather than waiting on a
   * scheduled job — see TenantSubscription.gracePeriodEndsAt's own doc
   * comment for why Phase 1 checks this on-request instead of via cron.
   * CANCELED is treated the same as SUSPENDED for access purposes — a
   * canceled subscription has no active billing relationship either.
   */
  private async resolveIsSuspended(subscription: { id: string; status: SubscriptionStatus; gracePeriodEndsAt: Date | null }): Promise<boolean> {
    if (subscription.status === SubscriptionStatus.SUSPENDED || subscription.status === SubscriptionStatus.CANCELED) {
      return true;
    }
    if (subscription.status === SubscriptionStatus.PAST_DUE && subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt < new Date()) {
      await this.prisma.tenantSubscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.SUSPENDED },
      });
      return true;
    }
    return false;
  }
}
