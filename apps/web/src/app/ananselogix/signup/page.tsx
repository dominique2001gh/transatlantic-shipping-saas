'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import type { SaasPlanSummary, SignupCompanyDetails } from '@transatlantic/shared';
import { SelectInput, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { ApiError } from '@/lib/api';
import { PLAN_DISPLAY_NAMES, fetchPublicPlans, formatCents } from '@/lib/ananselogix/plans';
import { serviceTypeOptions } from '@/lib/ananselogix/site-data';
import { createSignupCheckout, setSignupCompany, setSignupOwner, startSignup } from '@/lib/ananselogix/signup';

type Step = 1 | 2 | 3 | 4;

const TOKEN_STORAGE_KEY = 'ananselogix.signupToken';
const STEP_STORAGE_KEY = 'ananselogix.signupStep';

const TIMEZONE_OPTIONS = ['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'Africa/Accra', 'Europe/London', 'UTC'];

/**
 * AnanseLogix Phase 1: Steps 1-4 of the signup wizard (Section 7 of the
 * build brief). Step 5 (payment success) and beyond happen on
 * /ananselogix/signup/success, which polls the server — this page never
 * itself decides a signup succeeded; it only gets the prospect to Stripe.
 * `token`/`step` persist to localStorage so a page refresh (or a Stripe
 * "back" navigation) doesn't lose progress mid-wizard.
 *
 * Wrapped in <Suspense> below because useSearchParams() requires that
 * boundary for a statically-prerendered page in the App Router — same
 * reason (public)/login/page.tsx's SessionExpiredBanner is split out.
 */
export default function AnanseLogixSignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupWizard />
    </Suspense>
  );
}

function SignupWizard() {
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>(1);
  const [token, setToken] = useState<string | null>(null);
  const [plans, setPlans] = useState<SaasPlanSummary[] | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<SaasPlanSummary | null>(null);
  const [servicesOffered, setServicesOffered] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchPublicPlans().then(setPlans).catch(() => setPlans([]));

    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    const storedStep = localStorage.getItem(STEP_STORAGE_KEY);
    const urlToken = searchParams.get('token');
    if (urlToken) {
      setToken(urlToken);
      setStep(4);
    } else if (storedToken) {
      setToken(storedToken);
      setStep((Number(storedStep) as Step) || 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(STEP_STORAGE_KEY, String(step));
  }, [token, step]);

  // Pricing page's CTAs link here as /ananselogix/signup?plan=<planKey> —
  // once plans have loaded, auto-select the matching one and advance
  // straight past Step 1 so a prospect never has to click the same plan
  // twice. Only fires once, and never overrides an in-progress signup
  // already restored from a stored/URL token above.
  const autoSelectedPlanRef = useRef(false);
  useEffect(() => {
    if (autoSelectedPlanRef.current || token || !plans || plans.length === 0) return;
    const requestedKey = searchParams.get('plan');
    if (!requestedKey) return;
    const match = plans.find((plan) => plan.key === requestedKey);
    if (!match) return;
    autoSelectedPlanRef.current = true;
    handleChoosePlan(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, token]);

  async function handleChoosePlan(plan: SaasPlanSummary) {
    setError(null);
    setSubmitting(true);
    try {
      const { token: newToken } = await startSignup(plan.key);
      setSelectedPlan(plan);
      setToken(newToken);
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start signup — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOwnerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await setSignupOwner(token, {
        firstName: String(form.get('firstName') ?? ''),
        lastName: String(form.get('lastName') ?? ''),
        email: String(form.get('email') ?? ''),
        phone: String(form.get('phone') ?? '') || undefined,
        password,
        confirmPassword,
      });
      setStep(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your details — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompanySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    const details: SignupCompanyDetails = {
      legalName: String(form.get('legalName') ?? ''),
      tradingName: String(form.get('tradingName') ?? '') || undefined,
      businessPhone: String(form.get('businessPhone') ?? '') || undefined,
      businessEmail: String(form.get('businessEmail') ?? '') || undefined,
      existingWebsite: String(form.get('existingWebsite') ?? '') || undefined,
      country: String(form.get('country') ?? ''),
      stateRegion: String(form.get('stateRegion') ?? '') || undefined,
      city: String(form.get('city') ?? '') || undefined,
      address: String(form.get('address') ?? '') || undefined,
      timezone: String(form.get('timezone') ?? 'UTC'),
      primaryShippingMarkets: String(form.get('primaryShippingMarkets') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      serviceTypes: servicesOffered,
    };
    if (details.primaryShippingMarkets.length === 0 || details.serviceTypes.length === 0) {
      setError('Please provide at least one shipping market and select at least one service type.');
      return;
    }
    setSubmitting(true);
    try {
      await setSignupCompany(token, details);
      setStep(4);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your company details — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckout() {
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      const origin = window.location.origin;
      const { url } = await createSignupCheckout(
        token,
        `${origin}/ananselogix/signup/success?token=${token}`,
        `${origin}/ananselogix/signup?token=${token}`,
      );
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start checkout — please try again.');
      setSubmitting(false);
    }
  }

  function toggleService(service: string) {
    setServicesOffered((current) => (current.includes(service) ? current.filter((s) => s !== service) : [...current, service]));
  }

  return (
    <Container className="py-16 lg:py-20">
      <div className="mx-auto max-w-2xl">
        <ol aria-label="Signup progress" className="mb-10 flex items-center justify-between text-xs font-medium text-slate-400">
          {(['Plan', 'Owner Account', 'Company Details', 'Subscription'] as const).map((label, index) => (
            <li
              key={label}
              aria-current={step === index + 1 ? 'step' : undefined}
              className={`flex-1 text-center ${step === index + 1 ? 'text-primary-700' : ''}`}
            >
              <span
                className={`mx-auto mb-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                  step > index + 1 ? 'bg-primary-700 text-white' : step === index + 1 ? 'border-2 border-primary-700 text-primary-700' : 'border border-slate-300'
                }`}
              >
                {index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        {step === 1 && (
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Choose your plan</h1>
            <p className="mt-2 text-sm text-slate-600">You can review full pricing details before paying.</p>
            <div className="mt-6 flex flex-col gap-4">
              {plans === null && <p className="text-sm text-slate-500">Loading plans…</p>}
              {plans?.length === 0 && <p className="text-sm text-slate-500">No plans are available yet — please check back soon.</p>}
              {plans?.map((plan) => (
                <Card key={plan.id} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">{PLAN_DISPLAY_NAMES[plan.key]}</p>
                    <h3 className="font-display text-lg font-semibold text-slate-900">{plan.name}</h3>
                    {plan.price && (
                      <p className="mt-1 text-sm text-slate-600">
                        {formatCents(plan.price.effectiveMonthlyAmountCents, plan.price.currency)}/month
                      </p>
                    )}
                  </div>
                  <Button onClick={() => handleChoosePlan(plan)} disabled={submitting}>
                    Select
                  </Button>
                </Card>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <form onSubmit={handleOwnerSubmit} className="flex flex-col gap-5">
            <h1 className="font-display text-2xl font-bold text-slate-900">Create your owner account</h1>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <TextInput label="First name" id="firstName" name="firstName" required />
              <TextInput label="Last name" id="lastName" name="lastName" required />
              <TextInput label="Email" id="email" name="email" type="email" required />
              <TextInput label="Phone" id="phone" name="phone" type="tel" />
              <TextInput label="Password" id="password" name="password" type="password" minLength={8} required />
              <TextInput label="Confirm password" id="confirmPassword" name="confirmPassword" type="password" minLength={8} required />
            </div>
            <Button type="submit" size="lg" disabled={submitting} className="justify-center">
              {submitting ? 'Saving…' : 'Continue'}
            </Button>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={handleCompanySubmit} className="flex flex-col gap-5">
            <h1 className="font-display text-2xl font-bold text-slate-900">Tell us about your company</h1>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <TextInput label="Legal / business name" id="legalName" name="legalName" required />
              <TextInput label="Trading name" id="tradingName" name="tradingName" />
              <TextInput label="Business phone" id="businessPhone" name="businessPhone" type="tel" />
              <TextInput label="Business email" id="businessEmail" name="businessEmail" type="email" />
              <TextInput label="Existing website (if any)" id="existingWebsite" name="existingWebsite" />
              <TextInput label="Country" id="country" name="country" required />
              <TextInput label="State / region" id="stateRegion" name="stateRegion" />
              <TextInput label="City" id="city" name="city" />
              <TextInput label="Address" id="address" name="address" />
              <SelectInput label="Timezone" id="timezone" name="timezone" defaultValue="UTC">
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </SelectInput>
            </div>
            <TextInput
              label="Primary shipping markets (comma-separated)"
              id="primaryShippingMarkets"
              name="primaryShippingMarkets"
              placeholder="e.g. Ghana, Nigeria, United Kingdom"
              required
            />
            <div>
              <span id="signup-service-types-label" className="block text-sm font-medium text-slate-700">
                Service types
              </span>
              <div role="group" aria-labelledby="signup-service-types-label" className="mt-2 flex flex-wrap gap-2">
                {serviceTypeOptions.map((service) => (
                  <button
                    key={service}
                    type="button"
                    aria-pressed={servicesOffered.includes(service)}
                    onClick={() => toggleService(service)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      servicesOffered.includes(service)
                        ? 'border-primary-700 bg-primary-700 text-white'
                        : 'border-slate-300 text-slate-600 hover:border-primary-400'
                    }`}
                  >
                    {service}
                  </button>
                ))}
              </div>
            </div>
            <Button type="submit" size="lg" disabled={submitting} className="justify-center">
              {submitting ? 'Saving…' : 'Continue'}
            </Button>
          </form>
        )}

        {step === 4 && (
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Review &amp; subscribe</h1>
            <p className="mt-2 text-sm text-slate-600">
              You&rsquo;ll be redirected to Stripe&rsquo;s secure checkout to complete your subscription. Card details are never
              seen by AnanseLogix.
            </p>
            {selectedPlan?.price && (
              <Card className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">{PLAN_DISPLAY_NAMES[selectedPlan.key]}</p>
                <p className="mt-1 font-display text-2xl font-bold text-slate-900">
                  {formatCents(selectedPlan.price.effectiveMonthlyAmountCents, selectedPlan.price.currency)}/month
                </p>
                {selectedPlan.price.setupFeeCents > 0 && (
                  <p className="mt-1 text-sm text-slate-500">
                    + {formatCents(selectedPlan.price.setupFeeCents, selectedPlan.price.currency)} one-time setup fee
                  </p>
                )}
                {selectedPlan.price.trialDays > 0 && (
                  <p className="mt-1 text-sm font-medium text-accent-600">{selectedPlan.price.trialDays}-day free trial included</p>
                )}
              </Card>
            )}
            <Button onClick={handleCheckout} size="lg" disabled={submitting} className="mt-6 justify-center">
              {submitting ? 'Redirecting…' : 'Continue to Payment'}
            </Button>
          </div>
        )}
      </div>
    </Container>
  );
}
