import { SetMetadata } from '@nestjs/common';
import { EntitlementFeature } from '@prisma/client';

export const REQUIRE_ENTITLEMENT_KEY = 'requireEntitlement';

/**
 * AnanseLogix Phase 1: restricts a route to tenants whose TenantEntitlement
 * row for `feature` is enabled — checked by EntitlementsGuard alongside
 * (never instead of) the existing RolesGuard, since a role can be
 * permitted by RBAC while the tenant's *plan* still doesn't include the
 * feature (e.g. a WEBSITE_ONLY tenant's OWNER can administer their
 * own tenant but was never granted AI_AGENT). See EntitlementsGuard's own
 * doc comment for what happens to tenants with no TenantSubscription row
 * at all (grandfathered, e.g. Trans Atlantic).
 */
export const RequireEntitlement = (feature: EntitlementFeature) => SetMetadata(REQUIRE_ENTITLEMENT_KEY, feature);
