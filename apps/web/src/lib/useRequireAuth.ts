'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthenticatedUser, UserRole } from '@transatlantic/shared';
import { getStoredToken, getStoredUser } from './auth';

/**
 * Client-side route guard for the app shells (dashboard/portal/platform).
 *
 * This is a UX convenience only, not a security boundary — the API
 * enforces access with JwtAuthGuard + RolesGuard on every request
 * regardless of what the frontend does. A user without a valid token, or
 * whose role isn't in `allowedRoles`, is redirected to /login.
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

    if (!token || !storedUser || !allowedRoles.includes(storedUser.role)) {
      router.replace('/login');
      return;
    }

    setUser(storedUser);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { user, loading };
}
