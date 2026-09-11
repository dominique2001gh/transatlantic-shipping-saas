'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/marketing/AuthShell';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { acceptInvite, previewInvite } from '@/lib/staff';

/**
 * Staff Invitations stage — the page the invitation email points to. One
 * shared page across both brands, matching /forgot-password's own
 * doc comment for why (this backend endpoint has no way to know which
 * login page an owner/manager was using when they sent the invite).
 *
 * Two phases: a preview fetch (GET /auth/accept-invite/:token) decides
 * whether to show the password form or a clear invalid/expired message
 * *before* the employee starts typing — the password-reset page
 * deliberately skipped this pre-check to keep that stage minimal; this
 * one includes it since knowing "who/where" (the tenant name, their own
 * name) up front meaningfully helps a first-time user trust the page.
 */
function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewInvite>> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    previewInvite(token)
      .then(setPreview)
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : 'Unable to check this invitation right now.'));
  }, [token]);

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
      await acceptInvite({ token: token!, password, confirmPassword });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to complete your account right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <h1 className="font-display text-2xl font-bold text-slate-900">Invalid invitation link</h1>
        <p className="mt-2 text-sm text-slate-600">This link is missing its invitation token. Ask whoever invited you to resend it.</p>
      </AuthShell>
    );
  }

  if (submitted) {
    return (
      <AuthShell>
        <h1 className="font-display text-2xl font-bold text-slate-900">You&apos;re all set</h1>
        <p className="mt-2 text-sm text-slate-600">Your account is active. You can now sign in with the password you just created.</p>
        <Link href="/login" className="mt-8 inline-block text-sm font-semibold text-primary-700 hover:text-primary-800">
          Sign in
        </Link>
      </AuthShell>
    );
  }

  if (previewError) {
    return (
      <AuthShell>
        <h1 className="font-display text-2xl font-bold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">{previewError}</p>
      </AuthShell>
    );
  }

  if (!preview) {
    return (
      <AuthShell>
        <p className="text-sm text-slate-500">Checking your invitation…</p>
      </AuthShell>
    );
  }

  if (!preview.valid) {
    const message =
      preview.reason === 'expired'
        ? 'This invitation has expired. Ask whoever invited you to send a new one.'
        : preview.reason === 'already_used'
          ? 'This invitation has already been used.'
          : 'This invitation link is invalid.';
    return (
      <AuthShell>
        <h1 className="font-display text-2xl font-bold text-slate-900">This invitation isn&apos;t available</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Welcome, {preview.firstName}</h1>
      <p className="mt-2 text-sm text-slate-600">
        You&apos;ve been invited to join {preview.tenantName}. Create a password to activate your account.
      </p>

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <TextInput
          label="Password"
          id="password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextInput
          label="Confirm password"
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
          {loading ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
