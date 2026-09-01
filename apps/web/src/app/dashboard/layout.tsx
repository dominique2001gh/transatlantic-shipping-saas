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

  // UX only, not a security boundary (matches useRequireAuth's own
  // posture) — hides nav items whose action a role can't actually use, so
  // e.g. a warehouse-only user never sees "Invoices"/"Payments" only to
  // hit a 403. The API's @Roles() guard is what actually enforces access.
  const visibleNavItems = dashboardNavItems.filter((item) => !item.roles || item.roles.includes(user.role));

  return (
    <AppShell
      items={visibleNavItems}
      sidebarEyebrow="Staff Console"
      sidebarTitle={tenantName ?? 'Loading…'}
      tenantLabel={tenantName ?? 'Loading organization…'}
      userLabel={`${user.firstName} ${user.lastName}`}
    >
      {children}
    </AppShell>
  );
}
