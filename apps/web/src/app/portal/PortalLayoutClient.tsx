'use client';

import { useEffect } from 'react';
import { PORTAL_ROLES } from '@transatlantic/shared';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { portalNavItems } from '@/lib/nav';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTenant } from '@/lib/useTenant';

/**
 * Multi-tenant branding fix: the browser-tab title for /portal is set
 * server-side (see the sibling layout.tsx's own generateMetadata) to a
 * safe hostname-level default — Trans Atlantic's own on its own domain,
 * generic "AnanseLogix" otherwise — since the server has no way to know
 * which tenant an authenticated request belongs to (the session lives in
 * localStorage, not a cookie it could read). Once useTenant() resolves
 * the real tenant name client-side, this overrides document.title
 * directly with it, the same generic-then-specific pattern already used
 * by dropoff/[tenantSlug]'s kicker text. Reverts to the server-rendered
 * default on unmount so navigating away (e.g. logout) never leaves a
 * stale tenant name in the tab.
 */
function useTenantDocumentTitle(tenantName: string | null) {
  useEffect(() => {
    if (!tenantName) return;
    const previousTitle = document.title;
    document.title = `${tenantName} — Customer Portal`;
    return () => {
      document.title = previousTitle;
    };
  }, [tenantName]);
}

export default function PortalLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(PORTAL_ROLES);
  const { tenantName } = useTenant(!loading && !!user);
  useTenantDocumentTitle(tenantName);

  if (loading || !user) {
    return <LoadingScreen />;
  }

  return (
    <AppShell
      items={portalNavItems}
      sidebarEyebrow="Customer Portal"
      sidebarTitle={tenantName ?? 'Loading…'}
      tenantLabel={tenantName ?? 'Loading organization…'}
      userLabel={`${user.firstName} ${user.lastName}`}
    >
      {children}
    </AppShell>
  );
}
