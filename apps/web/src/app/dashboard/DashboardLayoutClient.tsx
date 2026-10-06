'use client';

import { useEffect } from 'react';
import { DASHBOARD_ROLES, hasPermission } from '@transatlantic/shared';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { TrialBanner } from '@/components/layout/TrialBanner';
import { dashboardNavItems } from '@/lib/nav';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTenant } from '@/lib/useTenant';

/**
 * Per-tenant favicon override — the future-facing half of the Titanic
 * branding-leak fix (see brand-icon.ts's own doc comment for the
 * Host-based default every tenant gets absent this). The dashboard is
 * server-rendered before any tenant identity is known (auth is
 * localStorage-based, resolved client-side only — see useTenant.ts), so
 * the *default* favicon can only ever be decided by Host at request time.
 * Once a specific tenant's own faviconUrl loads, this swaps the already-
 * rendered <link rel="icon"> in place. No-ops for every tenant today
 * (tenantFaviconUrl is always null until a Tenant.faviconUrl-shaped field
 * exists — see useTenant.ts) — Titanic included, so it correctly keeps
 * the AnanseLogix default rather than ever guessing at a per-tenant icon.
 */
function useTenantFaviconOverride(faviconUrl: string | null) {
  useEffect(() => {
    if (!faviconUrl) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const previousHref = link.href;
    link.href = faviconUrl;
    return () => {
      link.href = previousHref;
    };
  }, [faviconUrl]);
}

/**
 * Multi-tenant branding fix: see the sibling layout.tsx's own doc comment
 * for the server-side default this overrides once real tenant data
 * loads — same generic-then-specific pattern dropoff/[tenantSlug] and
 * PortalLayoutClient.tsx already use. Reverts on unmount so navigating
 * away (e.g. logout) never leaves a stale tenant name in the tab.
 */
function useTenantDocumentTitle(tenantName: string | null) {
  useEffect(() => {
    if (!tenantName) return;
    const previousTitle = document.title;
    document.title = `${tenantName} — Staff Console`;
    return () => {
      document.title = previousTitle;
    };
  }, [tenantName]);
}

export default function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(DASHBOARD_ROLES);
  const { tenantName, subscription, tenantFaviconUrl } = useTenant(!loading && !!user);
  useTenantFaviconOverride(tenantFaviconUrl);
  useTenantDocumentTitle(tenantName);

  if (loading || !user) {
    return <LoadingScreen />;
  }

  // UX only, not a security boundary (matches useRequireAuth's own
  // posture) — hides nav items whose action this role/permission grant
  // can't actually use, so e.g. a warehouse-only user never sees
  // "Invoices"/"Payments" only to hit a 403. The API's RolesGuard +
  // PermissionsGuard are what actually enforce access — see both guards'
  // own doc comments. `roles` is the coarse role-tier gate (unchanged
  // from before RBAC permissions existed); `permission` is the
  // fine-grained gate added on top, for a module an individual staff
  // member's own permission grant doesn't cover even though their role
  // tier could otherwise reach it.
  const visibleNavItems = dashboardNavItems.filter(
    (item) =>
      (!item.roles || item.roles.includes(user.role)) &&
      (!item.permission || hasPermission(user, item.permission)) &&
      (!item.anyPermission || item.anyPermission.some((key) => hasPermission(user, key))),
  );

  return (
    <>
      {/*
        Free Trial stage: visible to every dashboard role, not just OWNER/ADMIN
        — everyone should know before access locks, even though only
        OWNER/ADMIN can act on it. Gated on setupFeeStatus === 'PENDING'
        (never activated) so this never fires for a tenant that paid,
        subscribed, and later lapsed for an unrelated payment-failure
        reason (PAST_DUE/SUSPENDED with a real, already-paid setup fee) —
        that's a different, pre-existing scenario this banner isn't for.
      */}
      {subscription?.trialEndsAt && subscription.setupFeeStatus === 'PENDING' && (subscription.status === 'TRIALING' || subscription.status === 'SUSPENDED') && (
        <TrialBanner planName={subscription.planName} trialEndsAt={subscription.trialEndsAt} role={user.role} />
      )}
      <AppShell
        items={visibleNavItems}
        sidebarEyebrow="Staff Console"
        sidebarTitle={tenantName ?? 'Loading…'}
        tenantLabel={tenantName ?? 'Loading organization…'}
        userLabel={`${user.firstName} ${user.lastName}`}
      >
        {children}
      </AppShell>
    </>
  );
}
