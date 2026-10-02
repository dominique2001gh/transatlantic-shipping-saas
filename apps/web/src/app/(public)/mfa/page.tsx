'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { UserRole } from '@transatlantic/shared';
import { AuthShell } from '@/components/marketing/AuthShell';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { storeSession } from '@/lib/auth';
import { beginMfaSetup, clearPendingMfa, getPendingMfa, mfaChallenge, verifyMfaSetup } from '@/lib/mfa';
import { resolvePostLoginRoute } from '@/lib/post-login';

/**
 * Platform-wide staff MFA (2026-10): the one page every OWNER/MANAGER/
 * STAFF/FINANCE login now passes through between password and a real
 * session — reached only via /login or /ananselogix/login storing a
 * pending MFA state first (see storePendingMfa's own doc comment). A
 * direct visit with no pending state (token expired, tab reopened,
 * sessionStorage cleared) shows a dead-end message back to /login rather
 * than guessing — there is nothing this page can do without the token
 * POST /auth/login issued.
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

  return pending.mfaEnrolled ? (
    <MfaChallenge mfaToken={pending.mfaToken} nextPath={pending.nextPath} />
  ) : (
    <MfaEnrollment mfaToken={pending.mfaToken} nextPath={pending.nextPath} />
  );
}

async function finishAndRedirect(
  router: ReturnType<typeof useRouter>,
  nextPath: string | null,
  accessToken: string,
  user: Parameters<typeof storeSession>[1],
): Promise<void> {
  storeSession(accessToken, user);
  clearPendingMfa();
  const destination = nextPath && user.role === UserRole.CUSTOMER ? nextPath : await resolvePostLoginRoute(user);
  router.push(destination);
}

function MfaEnrollment({ mfaToken, nextPath }: { mfaToken: string; nextPath: string | null }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [pendingSession, setPendingSession] = useState<{ accessToken: string; user: Parameters<typeof storeSession>[1] } | null>(null);

  useEffect(() => {
    beginMfaSetup(mfaToken)
      .then(setSetup)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to start MFA enrollment right now.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await verifyMfaSetup(mfaToken, code);
      // Show the recovery codes exactly once before completing login —
      // this is the only time they will ever be shown.
      setRecoveryCodes(result.recoveryCodes);
      setPendingSession({ accessToken: result.accessToken, user: result.user });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (recoveryCodes && pendingSession) {
    return (
      <AuthShell>
        <h1 className="font-display text-2xl font-bold text-slate-900">Save your recovery codes</h1>
        <p className="mt-2 text-sm text-slate-600">
          If you ever lose access to your authenticator app, you can use one of these codes to sign in instead. Each
          code works once. We will not show these again.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-900">
          {recoveryCodes.map((rc) => (
            <span key={rc}>{rc}</span>
          ))}
        </div>
        <Button
          size="lg"
          className="mt-8 w-full justify-center"
          onClick={() => finishAndRedirect(router, nextPath, pendingSession.accessToken, pendingSession.user)}
        >
          I&apos;ve saved these — Continue
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Set up two-factor authentication</h1>
      <p className="mt-2 text-sm text-slate-600">
        Every staff account requires an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, or
        any other standards-compatible app). Scan this QR code to add your account.
      </p>

      {setup ? (
        <>
          <div className="mt-6 flex justify-center rounded-lg bg-white p-4 shadow-sm">
            <QRCodeSVG value={setup.otpauthUri} size={180} aria-label="MFA setup QR code" />
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">
            Can&apos;t scan? Enter this code manually: <span className="font-mono">{setup.secret}</span>
          </p>

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
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={loading} className="justify-center">
              {loading ? 'Verifying…' : 'Verify and continue'}
            </Button>
          </form>
        </>
      ) : (
        error && (
          <p role="alert" className="mt-6 text-sm text-red-600">
            {error}
          </p>
        )
      )}
    </AuthShell>
  );
}

function MfaChallenge({ mfaToken, nextPath }: { mfaToken: string; nextPath: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await mfaChallenge(mfaToken, useRecovery ? { recoveryCode } : { code });
      await finishAndRedirect(router, nextPath, result.accessToken, result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-2xl font-bold text-slate-900">Two-factor verification</h1>
      <p className="mt-2 text-sm text-slate-600">
        {useRecovery ? 'Enter one of your saved recovery codes.' : 'Enter the 6-digit code from your authenticator app.'}
      </p>

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        {useRecovery ? (
          <TextInput
            label="Recovery code"
            id="recoveryCode"
            autoComplete="off"
            required
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
          />
        ) : (
          <TextInput
            label="6-digit code"
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={loading} className="justify-center">
          {loading ? 'Verifying…' : 'Verify'}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          setUseRecovery((prev) => !prev);
          setError(null);
        }}
        className="mt-6 text-center text-sm font-semibold text-primary-700 hover:text-primary-800"
      >
        {useRecovery ? 'Use my authenticator app instead' : "Lost your device? Use a recovery code"}
      </button>
    </AuthShell>
  );
}
