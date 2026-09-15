'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthenticatedUser, UserRole } from '@transatlantic/shared';
import { getStoredToken, getStoredUser, homeRouteForRole } from './auth';

/**
 * Client-side route guard for the app shells (dashboard/portal/platform).
 *
 * This is a UX convenience only, not a security boundary — the API
 * enforces access with JwtAuthGuard + RolesGuard on every request
 * regardless of what the frontend does.
 *
 * RBAC billing-link fix (2026-09): a genuinely unauthenticated visitor
 * (no token, no stored user) is redirected to /login — that's correct,
 * there's no session to preserve. But a user who *is* authenticated, just
 * with a role this particular page doesn't allow (e.g. a MANAGER
 * following the trial banner's "Manage Billing" link to the OWNER-only
 * /onboarding page), must never be sent to /login — that page reads as
 * "you've been logged out," which is exactly the authorization-failure
 * regression this fixes: their token/session is left completely
 * untouched (nothing here ever calls clearSession/logout), they're just
 * redirected to the dashboard/portal/platform home their own role
 * actually belongs on.
 */
export function useRequireAuth(allowedRoles: UserRole[]): {
  user: AuthenticatedUser | null;
  loading: boolean;
} {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();

    if (!token || !storedUser) {
      router.replace('/login');
      return;
    }

    if (!allowedRoles.includes(storedUser.role)) {
      router.replace(homeRouteForRole(storedUser.role));
      return;
    }

    setUser(storedUser);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { user, loading };
}
