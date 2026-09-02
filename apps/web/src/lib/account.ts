import type { ChangePasswordRequest } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
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
