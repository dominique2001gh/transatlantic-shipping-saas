import type { AcceptInvitePreview, StaffMemberSummary, TenantInvitationSummary, UserRole } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  return apiFetch<T>(path, { ...options, token: token ?? undefined });
}

export function listStaff(): Promise<StaffMemberSummary[]> {
  return authedFetch('/users/staff');
}

export function listInvitations(): Promise<TenantInvitationSummary[]> {
  return authedFetch('/users/invitations');
}

export function inviteStaff(input: { firstName: string; lastName: string; email: string; role: UserRole }): Promise<TenantInvitationSummary> {
  return authedFetch('/users/invite', { method: 'POST', body: JSON.stringify(input) });
}

export function resendInvitation(id: string): Promise<TenantInvitationSummary> {
  return authedFetch(`/users/invitations/${id}/resend`, { method: 'POST' });
}

/** Public — no auth token, matching /auth/accept-invite/:token itself being @Public(). */
export function previewInvite(token: string): Promise<AcceptInvitePreview> {
  return apiFetch(`/auth/accept-invite/${token}`);
}

export function acceptInvite(input: { token: string; password: string; confirmPassword: string }): Promise<{ success: true }> {
  return apiFetch('/auth/accept-invite', { method: 'POST', body: JSON.stringify(input) });
}
