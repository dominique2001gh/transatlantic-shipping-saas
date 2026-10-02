'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { UserRole } from '@transatlantic/shared';
import { AuthShell } from '@/components/marketing/AuthShell';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { storeSession } from '@/lib/auth';
import { clearPendingMfa, getPendingMfa, sendMfaOtp, verifyMfaOtp } from '@/lib/mfa';
import { resolvePostLoginRoute } from '@/lib/post-login';

const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Email-based staff MFA (2026-10): the one page every OWNER/MANAGER/
 * STAFF/FINANCE login now passes through between password and a real
 * session — reached only via /login or /ananselogix/login storing a
 * pending MFA state first (see storePendingMfa's own doc comment). A
 * direct visit with no pending state (token expired, tab reopened,
 * sessionStorage cleared) shows a dead-end message back to /login rather
 * than guessing — there is nothing this page can do without the token
 * POST /auth/login issued. On mount it immediately emails the first
 * code (matching the server's own 30-second resend cooldown, mirrored
 * here only for the button's disabled state — the server is the real
 * enforcement).
 */
export default function MfaPage() {
  const pending = typeof window !== 'undefined' ? getPendingMfa() : null;

  if (!pending) {
    return (
      <AuthShell>
        <h1 className="font-display text-2xl font-bold text-slate-900">MFA session expired</h1>
        <p className="mt-2 text-sm text-slate-600">Please sign in again to continue.</p>
        <Link href="/login" className="mt-8 inline-block text-sm font-semibold text-primary-700 hover:text-primary-800">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return <MfaChallenge mfaToken={pending.mfaToken} nextPath={pending.nextPath} />;
}

function MfaChallenge({ mfaToken, nextPath }: { mfaToken: string; nextPath: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const sentOnce = useRef(false);

  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    sendMfaOtp(mfaToken)
      .then(() => {
        setInfo('We emailed you a 6-digit code.');
        setCooldown(RESEND_COOLDOWN_SECONDS);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to send a verification code right now.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleResend() {
    setError(null);
    setInfo(null);
    try {
      await sendMfaOtp(mfaToken);
      setInfo('We emailed you a new code.');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to send a new code right now.');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await verifyMfaOtp(mfaToken, code);
      storeSession(result.accessToken, result.user);
      clearPendingMfa();
      const destination =
        nextPath && result.user.role === UserRole.CUSTOMER ? nextPath : await resolvePostLoginRoute(result.user);
      router.push(destination);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Check your email</h1>
      <p className="mt-2 text-sm text-slate-600">Enter the 6-digit verification code we emailed you.</p>

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <TextInput
          label="6-digit code"
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />

        {info && <p className="text-sm text-slate-500">{info}</p>}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={submitting} className="justify-center">
          {submitting ? 'Verifying…' : 'Verify'}
        </Button>
      </form>

      <button
        type="button"
        disabled={cooldown > 0}
        onClick={handleResend}
        className="mt-6 text-center text-sm font-semibold text-primary-700 hover:text-primary-800 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        {cooldown > 0 ? `Resend code in ${cooldown}s` : "Didn't get a code? Resend"}
      </button>
    </AuthShell>
  );
}
