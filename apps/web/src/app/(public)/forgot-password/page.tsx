'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/marketing/AuthShell';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * Password recovery (Stage 3): shared by both login entry points (Trans
 * Atlantic's own /login and the central /ananselogix/login link to this
 * same page — see each page's own "Forgot password?" link). One page,
 * not duplicated per brand, since POST /auth/forgot-password has no way
 * to know which login page a request originated from (only the email),
 * and the response must be identical either way. Full per-brand visual
 * treatment is a Stage 6 item; this reuses the existing AuthShell as-is,
 * matching /login's own pattern.
 *
 * Always shows the same generic confirmation, regardless of what the API
 * actually did — the backend already never reveals whether the email
 * matched an account (see AuthService.requestPasswordReset), and this
 * page must not undo that by branching its own UI on success vs.
 * "nothing happened."
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSubmitted(true);
    } catch (err) {
      // Network/validation failures only (e.g. malformed email) — the
      // backend itself never returns an error for "email not found."
      setError(err instanceof ApiError ? err.message : 'Unable to send a reset link right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell>
        <h1 className="font-display text-2xl font-bold text-slate-900">Check your email</h1>
        <p className="mt-2 text-sm text-slate-600">
          If an account exists for that email, we&apos;ve sent password reset instructions.
        </p>
        <Link href="/login" className="mt-8 inline-block text-sm font-semibold text-primary-700 hover:text-primary-800">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Forgot your password?</h1>
      <p className="mt-2 text-sm text-slate-600">Enter your email and we&apos;ll send you a link to reset it.</p>

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <TextInput
          label="Email"
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={loading} className="mt-1 justify-center">
          {loading ? 'Sending…' : 'Send reset link'}
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
