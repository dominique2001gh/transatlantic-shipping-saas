'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { PERMISSION_KEYS, PERMISSION_PRESET_OPTIONS, STAFF_ROLES, UserRole, hasPermission } from '@transatlantic/shared';
import type { PermissionKey, RemovedStaffMemberSummary, StaffMemberSummary, TenantInvitationSummary } from '@transatlantic/shared';
import { SelectInput, TextInput } from '@/components/forms/FormField';
import { PermissionsPicker } from '@/components/staff/PermissionsPicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import {
  inviteStaff,
  listInvitations,
  listRemovedStaff,
  listStaff,
  removeStaffMember,
  resendInvitation,
  revokeInvitation,
  triggerStaffPasswordReset,
  updateStaffPermissions,
  updateStaffRole,
  updateStaffStatus,
} from '@/lib/staff';

const INVITABLE_ROLES = STAFF_ROLES;

/** Permissions the current user does NOT themselves hold — a non-owner can never grant authority they don't have (see UsersService.updatePermissions/StaffInvitationsService.invite). OWNER has no such restriction. */
function unauthorizedKeysFor(user: ReturnType<typeof getStoredUser>): ReadonlySet<string> {
  if (!user || user.role === UserRole.OWNER) return new Set();
  return new Set(PERMISSION_KEYS.filter((key) => !user.permissions.includes(key)));
}

/** Plain-language one-line summary of a permission set for the collapsed table row — exact preset match, empty, or a custom count. Never shows a raw permission key. */
function summarizePermissions(permissions: string[]): string {
  if (permissions.length === 0) return 'No extra access';
  const exactPreset = PERMISSION_PRESET_OPTIONS.find(
    (option) => option.key !== 'CUSTOM' && option.permissions.length === permissions.length && option.permissions.every((k) => permissions.includes(k)),
  );
  if (exactPreset) return exactPreset.label;
  return `Custom access (${permissions.length})`;
}

/**
 * RBAC permissions (Phase D): the Staff page is no longer OWNER-only —
 * invite/role-change/status-change/permission-change are each gated by
 * their own permission (staff.invite / staff.manage / staff.permissions),
 * with OWNER always passing (see hasPermission's own doc comment), the
 * same shape UsersController/PermissionsGuard already enforce server-
 * side. This page's own checks are UX only — every action still goes
 * through the real API, which re-enforces all of this (owner protection,
 * self-escalation prevention, tenant scoping) regardless of what this
 * page shows or hides.
 */
export default function StaffPage() {
  const currentUser = getStoredUser();
  const callerIsOwner = currentUser?.role === UserRole.OWNER;
  const canInvite = hasPermission(currentUser, 'staff.invite');
  const canManageRoleStatus = hasPermission(currentUser, 'staff.manage');
  const canManagePermissions = hasPermission(currentUser, 'staff.permissions');
  const unauthorizedKeys = unauthorizedKeysFor(currentUser);

  const [staff, setStaff] = useState<StaffMemberSummary[] | null>(null);
  const [invitations, setInvitations] = useState<TenantInvitationSummary[] | null>(null);
  const [removedStaff, setRemovedStaff] = useState<RemovedStaffMemberSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [resettingPasswordId, setResettingPasswordId] = useState<string | null>(null);
  const [passwordResetSentId, setPasswordResetSentId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  // Invite form: role and permissions are controlled (a preset choice
  // updates both at once); name/email stay plain uncontrolled fields read
  // via FormData, same as before. `inviteDefaults` + `inviteFormKey` are
  // the one addition: Reinvite (on a removed row) needs to prefill
  // name/email without converting these to controlled inputs — bumping
  // the key remounts the <form> with fresh `defaultValue`s instead. This
  // is deliberately independent of handleInvite's own currentTarget-
  // capture-before-await fix below (see staff-invite-form-reset.test.ts) —
  // that fix stays untouched.
  const [inviteDefaults, setInviteDefaults] = useState({ firstName: '', lastName: '', email: '' });
  const [inviteFormKey, setInviteFormKey] = useState(0);
  const [inviteRole, setInviteRole] = useState<UserRole>(UserRole.STAFF);
  const [invitePermissions, setInvitePermissions] = useState<PermissionKey[]>([]);

  // Which staff row's permission editor is open, and its in-progress draft.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<PermissionKey[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // See staff-invite-form-reset.test.ts: guards against a double-submit
  // racing past the `submitting` state before React re-renders the
  // disabled button.
  const inviteInFlightRef = useRef(false);

  function refresh() {
    listStaff()
      .then(setStaff)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load staff.'));
    if (canInvite) {
      listInvitations()
        .then(setInvitations)
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load invitations.'));
    }
    // Owner-managed staff administration (2026-10): GET /users/staff/removed
    // is gated server-side by staff.manage, same as the Remove action itself.
    if (canManageRoleStatus) {
      listRemovedStaff()
        .then(setRemovedStaff)
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load removed staff.'));
    }
  }

  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // See this file's own prior fix: `currentTarget` is only valid
    // synchronously, so it's captured here, before the `await` below.
    const formElement = event.currentTarget;

    if (inviteInFlightRef.current) return;
    inviteInFlightRef.current = true;

    setInviteError(null);
    setInviteSuccess(null);
    const form = new FormData(event.currentTarget);
    const firstName = String(form.get('firstName') ?? '');
    const lastName = String(form.get('lastName') ?? '');
    const email = String(form.get('email') ?? '');

    setSubmitting(true);
    try {
      await inviteStaff({
        firstName,
        lastName,
        email,
        role: inviteRole,
        // Owners are structurally full-access already — never send a
        // permission array for one (see PermissionsPicker's own doc
        // comment on why no OWNER preset exists).
        permissions: inviteRole === UserRole.OWNER ? undefined : invitePermissions,
      });
      setInviteSuccess(`Invitation sent to ${email}.`);
      setInviteError(null);
      formElement.reset();
      setInviteDefaults({ firstName: '', lastName: '', email: '' });
      setInviteRole(UserRole.STAFF);
      setInvitePermissions([]);
      refresh();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Failed to send invitation.');
      setInviteSuccess(null);
    } finally {
      setSubmitting(false);
      inviteInFlightRef.current = false;
    }
  }

  /**
   * Owner-managed staff administration (2026-10): prefills the Invite
   * form from a removed row's last known name/role/email — the row's
   * email is preserved (never mangled), so there's no need to make the
   * owner retype it. Bumping `inviteFormKey` remounts the (uncontrolled)
   * form with these as its new `defaultValue`s, since name/email aren't
   * controlled inputs (see this file's own note on why, just above).
   * Still a normal `invite()` call once submitted: it creates a
   * brand-new User row with a new id, never a restore of the old one.
   * Permissions are NOT prefilled — RBAC permissions are a fresh,
   * deliberate choice each time, the same reason this whole feature
   * exists for Kingsley-style pre-RBAC accounts.
   */
  function handleReinvite(member: RemovedStaffMemberSummary) {
    setInviteDefaults({ firstName: member.firstName, lastName: member.lastName, email: member.email });
    setInviteFormKey((k) => k + 1);
    setInviteRole(member.role === UserRole.OWNER ? UserRole.STAFF : member.role);
    setInvitePermissions([]);
    setInviteError(null);
    setInviteSuccess(null);
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

  /** Owner-managed staff administration (2026-10) — permanently cancels a still-pending invitation. */
  async function handleRevoke(id: string) {
    setRevokingId(id);
    setInviteError(null);
    try {
      await revokeInvitation(id);
      refresh();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Failed to cancel invitation.');
    } finally {
      setRevokingId(null);
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

  /** Owner-managed staff administration (2026-10) — one-way; see UsersService.removeStaffMember's own doc comment. */
  async function handleRemove(memberId: string) {
    setRemovingId(memberId);
    setRowError((prev) => ({ ...prev, [memberId]: '' }));
    try {
      await removeStaffMember(memberId);
      refresh();
    } catch (err) {
      setRowError((prev) => ({ ...prev, [memberId]: err instanceof ApiError ? err.message : 'Failed to remove staff member.' }));
    } finally {
      setRemovingId(null);
    }
  }

  /** Owner-managed staff administration (2026-10) — the caller never sees or sets the new password. */
  async function handleSendPasswordReset(memberId: string) {
    setResettingPasswordId(memberId);
    setPasswordResetSentId(null);
    setRowError((prev) => ({ ...prev, [memberId]: '' }));
    try {
      await triggerStaffPasswordReset(memberId);
      setPasswordResetSentId(memberId);
    } catch (err) {
      setRowError((prev) => ({ ...prev, [memberId]: err instanceof ApiError ? err.message : 'Failed to send password reset.' }));
    } finally {
      setResettingPasswordId(null);
    }
  }

  function openPermissionsEditor(member: StaffMemberSummary) {
    setEditingId(member.id);
    setEditDraft(member.permissions as PermissionKey[]);
    setEditError(null);
  }

  async function savePermissions(memberId: string) {
    setEditSaving(true);
    setEditError(null);
    try {
      await updateStaffPermissions(memberId, editDraft);
      setEditingId(null);
      refresh();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Failed to update permissions.');
    } finally {
      setEditSaving(false);
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

      {canInvite && (
        <Card className="mt-6 p-6">
          <h2 className="text-sm font-semibold text-slate-900">Invite an employee</h2>
          <form key={inviteFormKey} onSubmit={handleInvite} className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="w-full sm:w-40">
                <TextInput label="First name" id="firstName" name="firstName" defaultValue={inviteDefaults.firstName} required />
              </div>
              <div className="w-full sm:w-40">
                <TextInput label="Last name" id="lastName" name="lastName" defaultValue={inviteDefaults.lastName} required />
              </div>
              <div className="flex-1 sm:min-w-[14rem]">
                <TextInput label="Email" id="email" name="email" type="email" defaultValue={inviteDefaults.email} required />
              </div>
              <div className="w-48">
                <SelectInput
                  label="Role"
                  id="role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                >
                  {INVITABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role.replaceAll('_', ' ')}
                    </option>
                  ))}
                </SelectInput>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-900">Access &amp; permissions</h3>
              {inviteRole === UserRole.OWNER ? (
                <p className="mt-1 text-sm text-slate-500">
                  Owners automatically have full access to everything in Ananse Logix — there&apos;s nothing to configure here.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-slate-500">
                    Choose what this staff member is allowed to view or manage. You can change these permissions later.
                  </p>
                  <div className="mt-3">
                    <PermissionsPicker
                      value={invitePermissions}
                      onChange={setInvitePermissions}
                      onPresetSelect={setInviteRole}
                      disabledKeys={callerIsOwner ? undefined : unauthorizedKeys}
                    />
                  </div>
                </>
              )}
            </div>

            <div>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send Invite'}
              </Button>
            </div>
          </form>
          {inviteError && <p className="mt-3 text-sm text-red-600">{inviteError}</p>}
          {inviteSuccess && <p className="mt-3 text-sm text-emerald-600">{inviteSuccess}</p>}
        </Card>
      )}

      {canInvite && invitations && invitations.length > 0 && (
        <Card className="mt-6 overflow-x-auto p-0">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Pending &amp; recent invitations</div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Access</th>
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
                  <td className="px-4 py-3 text-slate-500">
                    {inv.role === UserRole.OWNER ? 'Full access' : summarizePermissions(inv.permissions)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{inv.status}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    {inv.status === 'PENDING' && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleResend(inv.id)}
                          disabled={resendingId === inv.id || revokingId === inv.id}
                          className="text-xs font-semibold text-primary-700 hover:text-primary-800 disabled:opacity-50"
                        >
                          {resendingId === inv.id ? 'Resending…' : 'Resend'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRevoke(inv.id)}
                          disabled={resendingId === inv.id || revokingId === inv.id}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {revokingId === inv.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      </div>
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
                <th className="px-4 py-3 font-medium">Access</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {(canManageRoleStatus || canManagePermissions) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((member) => {
                const isSelf = member.id === currentUser?.id;
                const targetIsOwner = member.role === UserRole.OWNER;
                // Mirrors UsersService's own owner-boundary/self-escalation
                // guards exactly — see assertCallerMayActOnOwnerBoundary/
                // assertCallerNotActingOnSelf. Disabling here is a UX
                // courtesy; the backend rejects these regardless.
                const canEditRoleOrStatus = canManageRoleStatus && (callerIsOwner || !targetIsOwner) && (callerIsOwner || !isSelf);
                const canEditPermissions = canManagePermissions && !targetIsOwner && (callerIsOwner || !isSelf);
                const isEditing = editingId === member.id;

                return (
                  <Fragment key={member.id}>
                    <tr>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {member.firstName} {member.lastName}
                        {isSelf && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{member.email}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {canEditRoleOrStatus ? (
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
                      <td className="px-4 py-3">
                        {targetIsOwner ? (
                          <Badge variant="primary">Full access</Badge>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Badge>{summarizePermissions(member.permissions)}</Badge>
                            {canEditPermissions && !isEditing && (
                              <button
                                type="button"
                                onClick={() => openPermissionsEditor(member)}
                                className="text-xs font-semibold text-primary-700 hover:text-primary-800"
                              >
                                Edit
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{member.isActive ? 'Active' : 'Inactive'}</td>
                      {(canManageRoleStatus || canManagePermissions) && (
                        <td className="px-4 py-3">
                          {canEditRoleOrStatus && (
                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() => handleStatusToggle(member.id, !member.isActive)}
                                disabled={busyRowId === member.id}
                                className="text-xs font-semibold text-primary-700 hover:text-primary-800 disabled:opacity-50"
                              >
                                {member.isActive ? 'Deactivate' : 'Reactivate'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSendPasswordReset(member.id)}
                                disabled={resettingPasswordId === member.id || !member.isActive}
                                className="text-xs font-semibold text-primary-700 hover:text-primary-800 disabled:opacity-50"
                                title={member.isActive ? undefined : 'Reactivate this account before sending a password reset'}
                              >
                                {resettingPasswordId === member.id ? 'Sending…' : 'Send reset email'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemove(member.id)}
                                disabled={removingId === member.id}
                                className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                              >
                                {removingId === member.id ? 'Removing…' : 'Remove'}
                              </button>
                            </div>
                          )}
                          {passwordResetSentId === member.id && (
                            <p className="mt-1 text-xs text-emerald-600">Reset email sent.</p>
                          )}
                          {rowError[member.id] && <p className="mt-1 text-xs text-red-600">{rowError[member.id]}</p>}
                        </td>
                      )}
                    </tr>
                    {isEditing && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50 px-4 py-4">
                          <p className="text-sm text-slate-500">
                            Choose what {member.firstName} is allowed to view or manage. Changes take effect immediately.
                          </p>
                          <div className="mt-3">
                            <PermissionsPicker
                              value={editDraft}
                              onChange={setEditDraft}
                              disabledKeys={callerIsOwner ? undefined : unauthorizedKeys}
                            />
                          </div>
                          {editError && <p className="mt-2 text-sm text-red-600">{editError}</p>}
                          <div className="mt-3 flex gap-2">
                            <Button type="button" size="sm" disabled={editSaving} onClick={() => savePermissions(member.id)}>
                              {editSaving ? 'Saving…' : 'Save permissions'}
                            </Button>
                            <Button type="button" variant="secondary" size="sm" disabled={editSaving} onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {canManageRoleStatus && removedStaff && removedStaff.length > 0 && (
        <Card className="mt-6 overflow-x-auto p-0">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Removed staff</div>
          <p className="px-4 pt-3 text-sm text-slate-500">
            Former staff members. Their activity history is preserved. Reinviting creates a brand-new account.
          </p>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Last role</th>
                <th className="px-4 py-3 font-medium">Removed</th>
                {canInvite && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {removedStaff.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {member.firstName} {member.lastName}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{member.email}</td>
                  <td className="px-4 py-3 text-slate-500">{member.role.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(member.removedAt).toLocaleDateString()}</td>
                  {canInvite && (
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleReinvite(member)}
                        className="text-xs font-semibold text-primary-700 hover:text-primary-800"
                      >
                        Reinvite
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
