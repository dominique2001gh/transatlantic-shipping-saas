import type { AcceptInvitePreview, RemovedStaffMemberSummary, StaffMemberSummary, TenantInvitationSummary, UserRole } from '@transatlantic/shared';
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

export function inviteStaff(input: {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  permissions?: string[];
}): Promise<TenantInvitationSummary> {
  return authedFetch('/users/invite', { method: 'POST', body: JSON.stringify(input) });
}

export function resendInvitation(id: string): Promise<TenantInvitationSummary> {
  return authedFetch(`/users/invitations/${id}/resend`, { method: 'POST' });
}

/** Owner-managed staff administration (2026-10) — permanently cancels a still-pending invitation. See UsersController.revokeInvitation. */
export function revokeInvitation(id: string): Promise<TenantInvitationSummary> {
  return authedFetch(`/users/invitations/${id}/revoke`, { method: 'POST' });
}

/** RBAC V1, OWNER only — see UsersController.updateRole. May reject with a 403 if this would leave the tenant with no active OWNER. */
export function updateStaffRole(id: string, role: UserRole): Promise<StaffMemberSummary> {
  return authedFetch(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
}

/** RBAC V1, OWNER only — see UsersController.updateStatus. May reject with a 403 if deactivating would leave the tenant with no active OWNER. */
export function updateStaffStatus(id: string, isActive: boolean): Promise<StaffMemberSummary> {
  return authedFetch(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
}

/**
 * RBAC permissions (2026-10): gated by the `staff.permissions` permission
 * (OWNER always passes) — see UsersService.updatePermissions for the full
 * set of backend guards (target can't be OWNER, caller can't target
 * themselves unless OWNER, caller can't grant what they don't themselves
 * hold). Sends the complete desired permission set, not a delta.
 */
export function updateStaffPermissions(id: string, permissions: string[]): Promise<StaffMemberSummary> {
  return authedFetch(`/users/${id}/permissions`, { method: 'PATCH', body: JSON.stringify({ permissions }) });
}

/** Owner-managed staff administration (2026-10) — see UsersService.findRemovedStaffForTenant. */
export function listRemovedStaff(): Promise<RemovedStaffMemberSummary[]> {
  return authedFetch('/users/staff/removed');
}

/**
 * Owner-managed staff administration (2026-10) — removes a staff member
 * without deleting their row or any historical record; frees their email
 * for a fresh invitation. See UsersService.removeStaffMember.
 */
export function removeStaffMember(id: string): Promise<RemovedStaffMemberSummary> {
  return authedFetch(`/users/${id}/remove`, { method: 'POST' });
}

/**
 * Owner-managed staff administration (2026-10) — sends a password-reset
 * email to this exact staff member; the caller never sees or sets the
 * new password. See UsersService.triggerPasswordReset.
 */
export function triggerStaffPasswordReset(id: string): Promise<{ success: true }> {
  return authedFetch(`/users/${id}/password-reset`, { method: 'POST' });
}

/** Public — no auth token, matching /auth/accept-invite/:token itself being @Public(). */
export function previewInvite(token: string): Promise<AcceptInvitePreview> {
  return apiFetch(`/auth/accept-invite/${token}`);
}

export function acceptInvite(input: { token: string; password: string; confirmPassword: string }): Promise<{ success: true }> {
  return apiFetch('/auth/accept-invite', { method: 'POST', body: JSON.stringify(input) });
}
