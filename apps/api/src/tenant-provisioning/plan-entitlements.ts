import { EntitlementFeature, SaasPlanType } from '@prisma/client';

/**
 * AnanseLogix Phase 1: the default TenantEntitlement rows stamped onto a
 * newly-provisioned tenant, keyed by which SaasPlan it subscribed to.
 * WEBSITE_ONLY tenants deliberately do not receive OPERATIONS_SOFTWARE/
 * CUSTOMER_PORTAL/TRACKING/ANALYTICS/AI_AGENT — Section 14 of the build
 * brief is explicit that a Website Only client must not automatically get
 * the full operations software. A platform admin can still override any
 * individual row afterward (promo access, manual grants) — see
 * TenantEntitlement's own doc comment; this map is only the starting
 * point, never re-applied after provisioning.
 */
export const PLAN_DEFAULT_ENTITLEMENTS: Record<SaasPlanType, Partial<Record<EntitlementFeature, boolean>>> = {
  [SaasPlanType.WEBSITE_ONLY]: {
    [EntitlementFeature.PUBLIC_WEBSITE]: true,
    [EntitlementFeature.PUBLIC_AI_AGENT]: true,
    [EntitlementFeature.BILLING]: true,
  },
  [SaasPlanType.SOFTWARE_ONLY]: {
    [EntitlementFeature.OPERATIONS_SOFTWARE]: true,
    [EntitlementFeature.CUSTOMER_PORTAL]: true,
    [EntitlementFeature.TRACKING]: true,
    [EntitlementFeature.BILLING]: true,
    [EntitlementFeature.ANALYTICS]: true,
    [EntitlementFeature.AI_AGENT]: true,
  },
  [SaasPlanType.WEBSITE_AND_SOFTWARE]: {
    [EntitlementFeature.PUBLIC_WEBSITE]: true,
    [EntitlementFeature.PUBLIC_AI_AGENT]: true,
    [EntitlementFeature.OPERATIONS_SOFTWARE]: true,
    [EntitlementFeature.CUSTOMER_PORTAL]: true,
    [EntitlementFeature.TRACKING]: true,
    [EntitlementFeature.BILLING]: true,
    [EntitlementFeature.ANALYTICS]: true,
    [EntitlementFeature.AI_AGENT]: true,
  },
  // Same full bundle as WEBSITE_AND_SOFTWARE above, which these two retired
  // it as the combined offering — no feature differentiation between Basic
  // and Professional was specified when they were introduced; a platform
  // admin can narrow either one's TenantEntitlement rows per-tenant later
  // (see that model's own doc comment) if a real tier split is wanted.
  [SaasPlanType.SOFTWARE_AND_WEBSITE_BASIC]: {
    [EntitlementFeature.PUBLIC_WEBSITE]: true,
    [EntitlementFeature.PUBLIC_AI_AGENT]: true,
    [EntitlementFeature.OPERATIONS_SOFTWARE]: true,
    [EntitlementFeature.CUSTOMER_PORTAL]: true,
    [EntitlementFeature.TRACKING]: true,
    [EntitlementFeature.BILLING]: true,
    [EntitlementFeature.ANALYTICS]: true,
    [EntitlementFeature.AI_AGENT]: true,
  },
  [SaasPlanType.SOFTWARE_AND_WEBSITE_PROFESSIONAL]: {
    [EntitlementFeature.PUBLIC_WEBSITE]: true,
    [EntitlementFeature.PUBLIC_AI_AGENT]: true,
    [EntitlementFeature.OPERATIONS_SOFTWARE]: true,
    [EntitlementFeature.CUSTOMER_PORTAL]: true,
    [EntitlementFeature.TRACKING]: true,
    [EntitlementFeature.BILLING]: true,
    [EntitlementFeature.ANALYTICS]: true,
    [EntitlementFeature.AI_AGENT]: true,
  },
};

/** Every feature not present in a plan's map above defaults to disabled. */
export function defaultEntitlementRows(planType: SaasPlanType): { feature: EntitlementFeature; enabled: boolean }[] {
  const overrides = PLAN_DEFAULT_ENTITLEMENTS[planType] ?? {};
  return Object.values(EntitlementFeature).map((feature) => ({
    feature,
    enabled: overrides[feature] ?? false,
  }));
}
