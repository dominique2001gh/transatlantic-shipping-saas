'use client';

import { PLATFORM_ROLES } from '@transatlantic/shared';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { platformNavItems } from '@/lib/nav';
import { platformConfig } from '@/lib/platform-config';
import { useRequireAuth } from '@/lib/useRequireAuth';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(PLATFORM_ROLES);

  if (loading || !user) {
    return <LoadingScreen />;
  }

  return (
    <AppShell
      items={platformNavItems}
      sidebarEyebrow={platformConfig.name}
      sidebarTitle="Platform Admin"
      tenantLabel="All Tenants"
      userLabel={`${user.firstName} ${user.lastName}`}
    >
      {children}
    </AppShell>
  );
}
