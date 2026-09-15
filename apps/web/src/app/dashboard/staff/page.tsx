'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { STAFF_ROLES, UserRole } from '@transatlantic/shared';
import type { StaffMemberSummary, TenantInvitationSummary } from '@transatlantic/shared';
import { SelectInput, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { inviteStaff, listInvitations, listStaff, resendInvitation, updateStaffRole, updateStaffStatus } from '@/lib/staff';

/**
 * RBAC V1: OWNER may invite/edit-role/deactivate/reactivate/promote —
 * MANAGER's "staff oversight" is explicitly view-only (can see this page
 * and the team roster, but none of the administration controls below).
 * Any other role reaching this page (STAFF_ROLES covers all 4 dashboard
 * roles) also gets view-only, matching prior behavior for non-owner staff.
 */
const INVITABLE_ROLES = STAFF_ROLES;

/**
 * Staff Invitations stage: the permanent, anytime staff-management
 * surface — GET /users/staff finally gets a real frontend consumer here,
 * alongside the new invite/list-invitations/resend endpoints. Only OWNER
 * can invite/resend/edit-role/deactivate (enforced by the API's own
 * @Roles() guard; this page's own role check is UX only, same caveat
 * every other role-gated NavItem/page in this app already documents —
 * see lib/nav.ts's own comment).
 */
export default function StaffPage() {
  const currentUser = getStoredUser();
  const canManageStaff = currentUser?.role === UserRole.OWNER;

  const [staff, setStaff] = useState<StaffMemberSummary[] | null>(null);
  const [invitations, setInvitations] = useState<TenantInvitationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  // Guards handleInvite against a duplicate submission (double-click,
  // double Enter, or a second click landing before React re-renders the
  // button as disabled={submitting}) — a plain ref, not state, because
  // React state updates are asynchronous/batched and two calls that both
  // start within the same tick would both still read the old `submitting`
  // value as false. A ref is set/read synchronously, so the second call
  // sees the first one's guard immediately, before either has awaited
  // anything. See the code review this fixes: two overlapping invite
  // submissions could otherwise both reach the API — one succeeding, the
  // other rejected by the backend's own duplicate-pending-invitation
  // check — and whichever settled second would silently leave its own
  // (contradictory) message on screen alongside the first's.
  const inviteInFlightRef = useRef(false);

  function refresh() {
    listStaff()
      .then(setStaff)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load staff.'));
    if (canManageStaff) {
      listInvitations()
        .then(setInvitations)
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load invitations.'));
    }
  }

  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Synchronous, immediate guard — see inviteInFlightRef's own doc
    // comment. Must be the very first thing this function does, before
    // any state update or await, so a second near-simultaneous call can
    // never slip through.
    if (inviteInFlightRef.current) return;
    inviteInFlightRef.current = true;

    setInviteError(null);
    setInviteSuccess(null);
    const form = new FormData(event.currentTarget);
    const firstName = String(form.get('firstName') ?? '');
    const lastName = String(form.get('lastName') ?? '');
    const email = String(form.get('email') ?? '');
    const role = String(form.get('role') ?? '') as UserRole;

    setSubmitting(true);
    try {
      await inviteStaff({ firstName, lastName, email, role });
      // Success and error are mutually exclusive by construction — each
      // branch explicitly clears the other, not just its own message, so
      // a slow-to-settle earlier attempt (or any future code path here)
      // can never leave a stale message of the opposite kind on screen.
      setInviteSuccess(`Invitation sent to ${email}.`);
      setInviteError(null);
      event.currentTarget.reset();
      refresh();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Failed to send invitation.');
      setInviteSuccess(null);
    } finally {
      setSubmitting(false);
      inviteInFlightRef.current = false;
    }
  }

  async function handleResend(id: string) {
    setResendingId(id);
    setInviteError(null);
    try {
      await resendInvitation(id);
      refresh();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Failed to resend invitation.');
    } finally {
      setResendingId(null);
    }
  }

  async function handleRoleChange(memberId: string, role: UserRole) {
    setBusyRowId(memberId);
    setRowError((prev) => ({ ...prev, [memberId]: '' }));
    try {
      await updateStaffRole(memberId, role);
      refresh();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [memberId]: err instanceof ApiError ? err.message : 'Failed to change role.' }));
    } finally {
      setBusyRowId(null);
    }
  }

  async function handleStatusToggle(memberId: string, nextIsActive: boolean) {
    setBusyRowId(memberId);
    setRowError((prev) => ({ ...prev, [memberId]: '' }));
    try {
      await updateStaffStatus(memberId, nextIsActive);
      refresh();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [memberId]: err instanceof ApiError ? err.message : 'Failed to update status.' }));
    } finally {
      setBusyRowId(null);
    }
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Staff</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your team. Invited employees create their own password from the invitation email — you never set or see it.
        </p>
      </div>

      {canManageStaff && (
        <Card className="mt-6 p-6">
          <h2 className="text-sm font-semibold text-slate-900">Invite an employee</h2>
          <form onSubmit={handleInvite} className="mt-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="w-full sm:w-40">
              <TextInput label="First name" id="firstName" name="firstName" required />
            </div>
            <div className="w-full sm:w-40">
              <TextInput label="Last name" id="lastName" name="lastName" required />
            </div>
            <div className="flex-1 sm:min-w-[14rem]">
              <TextInput label="Email" id="email" name="email" type="email" required />
            </div>
            <div className="w-48">
              <SelectInput label="Role" id="role" name="role" defaultValue={UserRole.STAFF}>
                {INVITABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role.replaceAll('_', ' ')}
                  </option>
                ))}
              </SelectInput>
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send Invite'}
            </Button>
          </form>
          {inviteError && <p className="mt-3 text-sm text-red-600">{inviteError}</p>}
          {inviteSuccess && <p className="mt-3 text-sm text-emerald-600">{inviteSuccess}</p>}
        </Card>
      )}

      {canManageStaff && invitations && invitations.length > 0 && (
        <Card className="mt-6 overflow-x-auto p-0">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Pending &amp; recent invitations</div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-3 text-slate-700">
                    {inv.firstName} {inv.lastName}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{inv.email}</td>
                  <td className="px-4 py-3 text-slate-500">{inv.role.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3 text-slate-500">{inv.status}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {inv.status === 'PENDING' && (
                      <button
                        type="button"
                        onClick={() => handleResend(inv.id)}
                        disabled={resendingId === inv.id}
                        className="text-xs font-semibold text-primary-700 hover:text-primary-800 disabled:opacity-50"
                      >
                        {resendingId === inv.id ? 'Resending…' : 'Resend'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mt-6 overflow-x-auto p-0">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Team</div>
        {error && <p className="p-6 text-sm text-red-600">{error}</p>}
        {!error && !staff && <p className="p-6 text-sm text-slate-500">Loading…</p>}
        {!error && staff && staff.length === 0 && <p className="p-6 text-sm text-slate-500">No staff yet.</p>}
        {!error && staff && staff.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {canManageStaff && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((member) => {
                const isSelf = member.id === currentUser?.id;
                return (
                  <tr key={member.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {member.firstName} {member.lastName}
                      {isSelf && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{member.email}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {canManageStaff ? (
                        <select
                          value={member.role}
                          disabled={busyRowId === member.id}
                          onChange={(e) => handleRoleChange(member.id, e.target.value as UserRole)}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
                        >
                          {STAFF_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role.replaceAll('_', ' ')}
                            </option>
                          ))}
                        </select>
                      ) : (
                        member.role.replaceAll('_', ' ')
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{member.isActive ? 'Active' : 'Inactive'}</td>
                    {canManageStaff && (
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleStatusToggle(member.id, !member.isActive)}
                          disabled={busyRowId === member.id}
                          className="text-xs font-semibold text-primary-700 hover:text-primary-800 disabled:opacity-50"
                        >
                          {member.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                        {rowError[member.id] && <p className="mt-1 text-xs text-red-600">{rowError[member.id]}</p>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
