'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getStoredToken } from '@/lib/auth';
import { beginFactorReplace, completeFactorReplace, getMfaStatus } from '@/lib/mfa';
import { QRCodeSVG } from 'qrcode.react';

/**
 * Platform-wide staff MFA (2026-10): self-service factor replacement for
 * an already-authenticated staff account — "lost my phone, got a new
 * one" without any admin involvement. Every staff role has MFA enrolled
 * by construction (see JwtStrategy's own doc comment — there is no way
 * to hold a staff session without it), so this never shows a "set up
 * MFA" state; only "replace my current factor."
 */
export function MfaSection() {
  const token = getStoredToken();
  const [status, setStatus] = useState<{ enabled: boolean; enrolledAt: string | null } | null>(null);
  const [step, setStep] = useState<'idle' | 'password' | 'verify' | 'done'>('idle');
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<{ secret: string; otpauthUri: string; replaceToken: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    getMfaStatus(token).then(setStatus).catch(() => undefined);
  }, [token]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await beginFactorReplace(token, currentPassword);
      setPending(result);
      setStep('verify');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to start factor replacement.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !pending) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await completeFactorReplace(token, pending.replaceToken, code);
      setRecoveryCodes(result.recoveryCodes);
      setStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">Two-factor authentication</h2>
      <Card className="mt-3 max-w-lg">
        {step === 'idle' && (
          <>
            <p className="text-sm text-slate-600">
              {status?.enabled
                ? `Enabled${status.enrolledAt ? ` since ${new Date(status.enrolledAt).toLocaleDateString()}` : ''}.`
                : 'Status loading…'}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Got a new phone or lost your authenticator app? Replace your factor below. You&apos;ll need your current
              password.
            </p>
            <Button type="button" className="mt-4 self-start" onClick={() => setStep('password')}>
              Replace my authenticator
            </Button>
          </>
        )}

        {step === 'password' && (
          <form className="flex flex-col gap-4" onSubmit={handlePasswordSubmit} noValidate>
            <TextInput
              label="Current password"
              id="mfaCurrentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting} className="self-start">
              {submitting ? 'Verifying…' : 'Continue'}
            </Button>
          </form>
        )}

        {step === 'verify' && pending && (
          <>
            <div className="flex justify-center rounded-lg bg-white p-4 shadow-sm">
              <QRCodeSVG value={pending.otpauthUri} size={160} aria-label="New MFA factor QR code" />
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">
              Manual entry code: <span className="font-mono">{pending.secret}</span>
            </p>
            <form className="mt-4 flex flex-col gap-4" onSubmit={handleVerifySubmit} noValidate>
              <TextInput
                label="6-digit code from the new device"
                id="mfaVerifyCode"
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
              <Button type="submit" disabled={submitting} className="self-start">
                {submitting ? 'Verifying…' : 'Activate new factor'}
              </Button>
            </form>
          </>
        )}

        {step === 'done' && recoveryCodes && (
          <>
            <p className="text-sm text-slate-900">Your new factor is active. Save your new recovery codes below — your old ones no longer work.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-900">
              {recoveryCodes.map((rc) => (
                <span key={rc}>{rc}</span>
              ))}
            </div>
            <Button
              type="button"
              className="mt-4 self-start"
              onClick={() => {
                setStep('idle');
                setCurrentPassword('');
                setCode('');
                setPending(null);
                setRecoveryCodes(null);
                if (token) getMfaStatus(token).then(setStatus).catch(() => undefined);
              }}
            >
              Done
            </Button>
          </>
        )}
      </Card>
    </section>
  );
}
