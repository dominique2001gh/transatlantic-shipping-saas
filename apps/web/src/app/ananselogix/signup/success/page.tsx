'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Container } from '@/components/ui/Container';
import { LinkButton } from '@/components/ui/Button';
import { getSignupStatus } from '@/lib/ananselogix/signup';

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 60; // 2.5 minutes

/**
 * AnanseLogix Phase 1, Step 5 (Section 7): "Verify payment/subscription
 * server-side. Never trust only frontend redirect parameters." This page
 * deliberately reads no query params to decide success/failure — it only
 * polls GET /public/signup/:token/status, which reflects what the Stripe
 * webhook has actually confirmed server-side (see SignupStatusResponse's
 * own doc comment). `token` in the URL is only ever used as a lookup key,
 * never trusted as proof of anything.
 */
function SignupSuccessContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<'waiting' | 'done' | 'timeout' | 'error'>('waiting');
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }
    let cancelled = false;

    async function poll() {
      try {
        const result = await getSignupStatus(token!);
        if (cancelled) return;
        if (result.status === 'COMPLETED') {
          setTenantSlug(result.tenantSlug);
          setState('done');
          localStorage.removeItem('ananselogix.signupToken');
          localStorage.removeItem('ananselogix.signupStep');
          return;
        }
        if (result.status === 'EXPIRED') {
          setState('error');
          return;
        }
        attempts.current += 1;
        if (attempts.current >= MAX_POLL_ATTEMPTS) {
          setState('timeout');
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) setState('error');
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      {state === 'waiting' && (
        <>
          <h1 className="font-display text-2xl font-bold text-slate-900">Finalizing your subscription…</h1>
          <p className="mt-3 max-w-md text-sm text-slate-600">
            This usually takes a few seconds while we confirm your payment and set up your company.
          </p>
        </>
      )}
      {state === 'done' && (
        <>
          <h1 className="font-display text-2xl font-bold text-slate-900">Your company is ready 🎉</h1>
          <p className="mt-3 max-w-md text-sm text-slate-600">
            Your subscription is active. Log in to continue with onboarding.
          </p>
          <LinkButton href="/ananselogix/login" size="lg" className="mt-6">
            Log In {tenantSlug ? `to ${tenantSlug}` : ''}
          </LinkButton>
        </>
      )}
      {state === 'timeout' && (
        <>
          <h1 className="font-display text-2xl font-bold text-slate-900">Still working on it…</h1>
          <p className="mt-3 max-w-md text-sm text-slate-600">
            This is taking longer than expected. If you completed payment, you&rsquo;ll receive a confirmation email —
            try logging in shortly, or contact us if this persists.
          </p>
          <Link href="/ananselogix/login" className="mt-6 text-sm font-medium text-primary-700">
            Go to login
          </Link>
        </>
      )}
      {state === 'error' && (
        <>
          <h1 className="font-display text-2xl font-bold text-slate-900">We couldn&rsquo;t confirm this signup</h1>
          <p className="mt-3 max-w-md text-sm text-slate-600">
            This signup link may have expired. Please start again, or contact us for help.
          </p>
          <LinkButton href="/ananselogix/signup" size="lg" className="mt-6">
            Start Over
          </LinkButton>
        </>
      )}
    </Container>
  );
}

export default function AnanseLogixSignupSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SignupSuccessContent />
    </Suspense>
  );
}
