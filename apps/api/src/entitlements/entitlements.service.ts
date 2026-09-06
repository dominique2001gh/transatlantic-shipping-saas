import { Injectable } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';
import type { TenantEntitlementItem } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AnanseLogix Phase 1: read-side companion to EntitlementsGuard — lets the
 * frontend ask "what can this tenant see" up front (to hide nav items,
 * show upgrade prompts) rather than discovering a 403 per feature. A
 * tenant with no TenantSubscription row is reported as fully entitled to
 * every feature — see EntitlementsGuard's own doc comment for why.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForTenant(tenantId: string): Promise<TenantEntitlementItem[]> {
    const subscription = await this.prisma.tenantSubscription.findUnique({ where: { tenantId } });
    if (!subscription) {
      return Object.values(EntitlementFeature).map((feature) => ({
        feature: feature as unknown as TenantEntitlementItem['feature'],
        enabled: true,
      }));
    }

    const rows = await this.prisma.tenantEntitlement.findMany({ where: { tenantId } });
    const byFeature = new Map(rows.map((row) => [row.feature, row.enabled]));
    return Object.values(EntitlementFeature).map((feature) => ({
      feature: feature as unknown as TenantEntitlementItem['feature'],
      enabled: byFeature.get(feature) ?? false,
    }));
  }
}
