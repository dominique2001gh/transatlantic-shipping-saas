import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { EntitlementFeature } from '@prisma/client';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRE_ENTITLEMENT_KEY } from '../decorators/require-entitlement.decorator';

/**
 * AnanseLogix Phase 1: enforces @RequireEntitlement(...) metadata. Runs
 * after JwtAuthGuard/RolesGuard, so req.user is always populated. Routes
 * with no @RequireEntitlement() metadata are unaffected — this guard is
 * additive, never a replacement for RolesGuard's RBAC check.
 *
 * A tenant with no TenantSubscription row at all (Trans Atlantic,
 * bootstrapped directly before this SaaS layer existed — see
 * TenantSubscription's own doc comment) is treated as fully entitled to
 * every feature, so this guard can never retroactively lock out a tenant
 * that predates plan/entitlement modeling. PLATFORM_ADMIN (tenantId null)
 * is likewise exempt — entitlements are a tenant-plan concept, not
 * something a platform admin's own account could ever lack.
 */
@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<EntitlementFeature | undefined>(REQUIRE_ENTITLEMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user?.tenantId) {
      return true;
    }

    const subscription = await this.prisma.tenantSubscription.findUnique({ where: { tenantId: user.tenantId } });
    if (!subscription) {
      return true;
    }

    const entitlement = await this.prisma.tenantEntitlement.findUnique({
      where: { tenantId_feature: { tenantId: user.tenantId, feature } },
    });
    // Fail closed: a tenant *with* a subscription is expected to have all
    // EntitlementFeature rows stamped at provisioning time (see
    // defaultEntitlementRows) — a missing row is treated the same as an
    // explicitly disabled one, not silently allowed.
    if (!entitlement?.enabled) {
      throw new ForbiddenException(`Your plan does not include this feature (${feature})`);
    }

    return true;
  }
}
