'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/marketing/AuthShell';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * Password recovery (Stage 3) — the page the emailed reset link points
 * to (see AuthService.requestPasswordReset's resetUrl). Shared across
 * both brands the same way /forgot-password is — see that page's own
 * doc comment for why one page, not two.
 *
 * `useSearchParams()` requires a <Suspense> boundary for a statically-
 * prerendered page in the App Router (matching the exact pattern
 * (public)/login's own SessionExpiredBanner already establishes), so the
 * token-dependent form lives in its own inner component.
 */
function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      setSubmitted(true);
    } catch (err) {
      // Covers both "invalid" and "expired" — AuthService.resetPassword's
      // own messages already distinguish them where it's safe to (see its
      // own doc comment); this just surfaces whatever it returned.
      setError(err instanceof ApiError ? err.message : 'Unable to reset your password right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <h1 className="font-display text-2xl font-bold text-slate-900">Invalid reset link</h1>
        <p className="mt-2 text-sm text-slate-600">
          This link is missing its reset token. Please request a new password reset link.
        </p>
        <Link
          href="/forgot-password"
          className="mt-8 inline-block text-sm font-semibold text-primary-700 hover:text-primary-800"
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  if (submitted) {
    return (
      <AuthShell>
        <h1 className="font-display text-2xl font-bold text-slate-900">Password reset</h1>
        <p className="mt-2 text-sm text-slate-600">Your password has been updated. You can now sign in with it.</p>
        <Link href="/login" className="mt-8 inline-block text-sm font-semibold text-primary-700 hover:text-primary-800">
          Sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Set a new password</h1>
      <p className="mt-2 text-sm text-slate-600">Choose a new password for your account.</p>

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <TextInput
          label="New password"
          id="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextInput
          label="Confirm new password"
          id="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={loading} className="mt-1 justify-center">
          {loading ? 'Resetting…' : 'Reset password'}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-500">
        <Link href="/login" className="font-semibold text-primary-700 hover:text-primary-800">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
