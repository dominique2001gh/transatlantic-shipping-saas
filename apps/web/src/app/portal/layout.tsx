'use client';

import { PORTAL_ROLES } from '@transatlantic/shared';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { portalNavItems } from '@/lib/nav';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTenant } from '@/lib/useTenant';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(PORTAL_ROLES);
  const { tenantName } = useTenant(!loading && !!user);

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
