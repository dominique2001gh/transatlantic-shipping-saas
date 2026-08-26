'use client';

import { DASHBOARD_ROLES } from '@transatlantic/shared';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { dashboardNavItems } from '@/lib/nav';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTenant } from '@/lib/useTenant';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(DASHBOARD_ROLES);
  const { tenantName } = useTenant(!loading && !!user);

  if (loading || !user) {
    return <LoadingScreen />;
  }

  return (
    <AppShell
      items={dashboardNavItems}
      sidebarEyebrow="Staff Console"
      sidebarTitle={tenantName ?? 'Loading…'}
      tenantLabel={tenantName ?? 'Loading organization…'}
      userLabel={`${user.firstName} ${user.lastName}`}
    >
      {children}
    </AppShell>
  );
}
