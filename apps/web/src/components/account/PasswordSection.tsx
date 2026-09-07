'use client';

import { useState, type FormEvent } from 'react';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { changePassword } from '@/lib/account';
import { ApiError } from '@/lib/api';

/**
 * Stage 3I, extracted: self-service password change, usable by any
 * authenticated role — originally only mounted on the customer portal's
 * Profile page, now shared with the staff/tenant-owner dashboard Settings
 * page too. No role-specific logic here at all: PATCH /users/me/password
 * (via changePassword()) is already role-agnostic server-side, always
 * scoped to the caller's own account via their JWT — this component never
 * sends a userId/tenantId/customerId of its own, so mounting it anywhere
 * an authenticated user lands is safe by construction.
 */
export function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change your password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">Password</h2>
      <Card className="mt-3 max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <TextInput
            label="Current password"
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <TextInput
            label="New password"
            id="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <TextInput
            label="Confirm new password"
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <p className="text-xs text-slate-400">At least 8 characters.</p>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {saved && <p className="text-sm text-green-700">Password changed.</p>}
          <Button type="submit" disabled={submitting} className="mt-2 self-start">
            {submitting ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      </Card>
    </section>
  );
}
