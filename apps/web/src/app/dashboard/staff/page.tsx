'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { STAFF_ROLES, UserRole } from '@transatlantic/shared';
import type { StaffMemberSummary, TenantInvitationSummary } from '@transatlantic/shared';
import { SelectInput, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { inviteStaff, listInvitations, listStaff, resendInvitation } from '@/lib/staff';

/** Same "never invite someone in as the owner" rule the onboarding wizard's own Staff step already applies. */
const INVITABLE_ROLES = STAFF_ROLES.filter((role) => role !== UserRole.TENANT_OWNER);

/**
 * Staff Invitations stage: the permanent, anytime staff-management
 * surface — GET /users/staff finally gets a real frontend consumer here,
 * alongside the new invite/list-invitations/resend endpoints. Only
 * TENANT_OWNER/WAREHOUSE_MANAGER can invite or resend (enforced by the
 * API's own @Roles() guard; this page's own role check is UX only, same
 * caveat every other role-gated NavItem/page in this app already
 * documents — see lib/nav.ts's own comment).
 */
export default function StaffPage() {
  const currentUser = getStoredUser();
  const canManageInvites = currentUser?.role === UserRole.TENANT_OWNER || currentUser?.role === UserRole.WAREHOUSE_MANAGER;

  const [staff, setStaff] = useState<StaffMemberSummary[] | null>(null);
  const [invitations, setInvitations] = useState<TenantInvitationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  function refresh() {
    listStaff()
      .then(setStaff)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load staff.'));
    if (canManageInvites) {
      listInvitations()
        .then(setInvitations)
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load invitations.'));
    }
  }

  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setInviteSuccess(`Invitation sent to ${email}.`);
      event.currentTarget.reset();
      refresh();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Failed to send invitation.');
    } finally {
      setSubmitting(false);
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

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Staff</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your team. Invited employees create their own password from the invitation email — you never set or see it.
        </p>
      </div>

      {canManageInvites && (
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
              <SelectInput label="Role" id="role" name="role" defaultValue={UserRole.WAREHOUSE_STAFF}>
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

      {canManageInvites && invitations && invitations.length > 0 && (
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {member.firstName} {member.lastName}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{member.email}</td>
                  <td className="px-4 py-3 text-slate-500">{member.role.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3 text-slate-500">{member.isActive ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
