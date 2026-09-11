'use client';

import { DASHBOARD_ROLES } from '@transatlantic/shared';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { TrialBanner } from '@/components/layout/TrialBanner';
import { dashboardNavItems } from '@/lib/nav';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTenant } from '@/lib/useTenant';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRequireAuth(DASHBOARD_ROLES);
  const { tenantName, subscription } = useTenant(!loading && !!user);

  if (loading || !user) {
    return <LoadingScreen />;
  }

  // UX only, not a security boundary (matches useRequireAuth's own
  // posture) — hides nav items whose action a role can't actually use, so
  // e.g. a warehouse-only user never sees "Invoices"/"Payments" only to
  // hit a 403. The API's @Roles() guard is what actually enforces access.
  const visibleNavItems = dashboardNavItems.filter((item) => !item.roles || item.roles.includes(user.role));

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
        <TrialBanner planName={subscription.planName} trialEndsAt={subscription.trialEndsAt} />
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
