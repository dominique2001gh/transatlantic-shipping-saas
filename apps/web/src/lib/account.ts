import type { AuthenticatedUser, ChangePasswordRequest } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * RBAC permissions (2026-10): GET /users/me — the live, current-request
 * view of the caller's own account, `permissions` included. Used by
 * useRequireAuth to refresh the locally-stored user on every dashboard
 * mount, so a permission grant/revocation an OWNER just made shows up in
 * this person's own nav/UI without needing them to log out and back in —
 * the stored-at-login copy in localStorage would otherwise go stale the
 * moment anyone's permissions change mid-session. UX freshness only: the
 * backend's own per-request DB read (JwtStrategy) is what actually
 * enforces the current permission set regardless of what this returns.
 */
export function getCurrentUser(): Promise<AuthenticatedUser> {
  return apiFetch<AuthenticatedUser>('/users/me', { token: authToken() });
}

/**
 * Stage 3I: typed client for PATCH /users/me/password. Deliberately not
 * in lib/portal.ts — this endpoint is role-agnostic (any authenticated
 * User, not just CUSTOMER), always the caller's own account. See
 * AuthService.changePassword for the actual current-password
 * verification + rehash; this file does no filtering of its own.
 */
export function changePassword(payload: ChangePasswordRequest): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/users/me/password', {
    method: 'PATCH',
    body: JSON.stringify(payload),
    token: authToken(),
  });
}
