'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ONBOARDING_ROLES, STAFF_ROLES, UserRole } from '@transatlantic/shared';
import { SelectInput, TextInput } from '@/components/forms/FormField';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { ApiError } from '@/lib/api';
import { platformConfig } from '@/lib/platform-config';
import { logout } from '@/lib/auth';
import {
  completeStaffStep,
  createBillingPortalSession,
  finishOnboarding,
  getOnboardingOverview,
  inviteStaff,
  updateBranding,
  updateNotifications,
  updateOperations,
  updateTracking,
  type OnboardingOverview,
} from '@/lib/onboarding';
import { useRequireAuth } from '@/lib/useRequireAuth';

const STEPS = ['BRANDING', 'OPERATIONS', 'STAFF', 'TRACKING', 'NOTIFICATIONS', 'BILLING', 'DONE'] as const;
const STEP_LABELS: Record<(typeof STEPS)[number], string> = {
  BRANDING: 'Branding',
  OPERATIONS: 'Operations',
  STAFF: 'Staff',
  TRACKING: 'Tracking',
  NOTIFICATIONS: 'Notifications',
  BILLING: 'Billing',
  DONE: 'Done',
};
const INVITABLE_ROLES = STAFF_ROLES.filter((role) => role !== UserRole.TENANT_OWNER);

/**
 * AnanseLogix Phase 1: the post-signup onboarding wizard (Section 8) —
 * Branding -> Operations -> Staff -> Tracking -> Notifications -> Billing
 * -> Finish. Each step posts to its own /onboarding/* endpoint (see
 * lib/onboarding.ts) and the server, not this page, decides when the
 * wizard actually advances (OnboardingService.advanceStep never regresses
 * or skips ahead) — this page just reflects whatever currentStep comes
 * back.
 */
export default function OnboardingPage() {
  const { user, loading } = useRequireAuth(ONBOARDING_ROLES);
  const [overview, setOverview] = useState<OnboardingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    getOnboardingOverview()
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load onboarding'));
  }, [user]);

  if (loading || !user) return <LoadingScreen />;

  const step = overview?.onboarding.currentStep ?? 'BRANDING';
  const stepIndex = STEPS.indexOf(step);

  async function refresh() {
    const next = await getOnboardingOverview();
    setOverview(next);
  }

  async function runStep(action: () => Promise<unknown>) {
    setError(null);
    setSubmitting(true);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <Container className="flex items-center justify-between py-4">
          <span className="font-display text-lg font-bold text-slate-900">{platformConfig.name} Setup</span>
          <button onClick={() => logout()} className="text-sm font-medium text-slate-500 hover:text-slate-700">
            Log out
          </button>
        </Container>
      </header>

      <Container className="py-10">
        <ol aria-label="Onboarding progress" className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-slate-400">
          {STEPS.filter((s) => s !== 'DONE').map((s, index) => (
            <li
              key={s}
              aria-current={index === stepIndex ? 'step' : undefined}
              className={index === stepIndex ? 'text-primary-700' : index < stepIndex ? 'text-slate-600' : ''}
            >
              {index + 1}. {STEP_LABELS[s]}
            </li>
          ))}
        </ol>

        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
        {!overview && !error && <p className="text-sm text-slate-500">Loading…</p>}

        {overview && step === 'BRANDING' && (
          <BrandingStep
            overview={overview}
            submitting={submitting}
            onSubmit={(input) => runStep(() => updateBranding(input))}
          />
        )}
        {overview && step === 'OPERATIONS' && (
          <OperationsStep submitting={submitting} onSubmit={(input) => runStep(() => updateOperations(input))} />
        )}
        {overview && step === 'STAFF' && (
          <StaffStep
            overview={overview}
            submitting={submitting}
            onInvite={(input) => runStep(() => inviteStaff(input))}
            onContinue={() => runStep(() => completeStaffStep())}
          />
        )}
        {overview && step === 'TRACKING' && (
          <TrackingStep submitting={submitting} onSubmit={(input) => runStep(() => updateTracking(input))} />
        )}
        {overview && step === 'NOTIFICATIONS' && (
          <NotificationsStep submitting={submitting} onSubmit={(input) => runStep(() => updateNotifications(input))} />
        )}
        {overview && step === 'BILLING' && (
          <BillingStep overview={overview} submitting={submitting} onFinish={() => runStep(() => finishOnboarding())} />
        )}
        {overview && step === 'DONE' && <DoneStep />}
      </Container>
    </div>
  );
}

function StepCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card className="mx-auto max-w-2xl">
      <h1 className="font-display text-xl font-bold text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      <div className="mt-6">{children}</div>
    </Card>
  );
}

function BrandingStep({
  overview,
  submitting,
  onSubmit,
}: {
  overview: OnboardingOverview;
  submitting: boolean;
  onSubmit: (input: Parameters<typeof updateBranding>[0]) => void;
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    onSubmit({
      displayName: String(form.get('displayName') ?? '') || undefined,
      logoUrl: String(form.get('logoUrl') ?? '') || undefined,
      primaryColor: String(form.get('primaryColor') ?? '') || undefined,
      secondaryColor: String(form.get('secondaryColor') ?? '') || undefined,
      publicPhone: String(form.get('publicPhone') ?? '') || undefined,
      publicEmail: String(form.get('publicEmail') ?? '') || undefined,
      whatsappNumber: String(form.get('whatsappNumber') ?? '') || undefined,
    });
  }
  return (
    <StepCard title="Company branding" description="How your company appears to staff and customers.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextInput label="Display name" id="displayName" name="displayName" defaultValue={overview.tenant.name} />
        <TextInput label="Logo URL" id="logoUrl" name="logoUrl" defaultValue={overview.tenant.logoUrl ?? ''} />
        <div className="grid grid-cols-2 gap-5">
          <TextInput label="Primary color" id="primaryColor" name="primaryColor" placeholder="#0f2f5f" defaultValue={overview.tenant.primaryColor ?? ''} />
          <TextInput label="Secondary color" id="secondaryColor" name="secondaryColor" placeholder="#14b8a6" defaultValue={overview.tenant.secondaryColor ?? ''} />
        </div>
        <TextInput label="Public phone" id="publicPhone" name="publicPhone" defaultValue={overview.tenant.phone ?? ''} />
        <TextInput label="Public email" id="publicEmail" name="publicEmail" type="email" defaultValue={overview.tenant.email} />
        <TextInput label="WhatsApp number" id="whatsappNumber" name="whatsappNumber" defaultValue={overview.tenant.whatsappNumber ?? ''} />
        <Button type="submit" disabled={submitting} className="justify-center">
          {submitting ? 'Saving…' : 'Continue'}
        </Button>
      </form>
    </StepCard>
  );
}

function OperationsStep({ submitting, onSubmit }: { submitting: boolean; onSubmit: (input: Parameters<typeof updateOperations>[0]) => void }) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get('warehouseName') ?? '');
    const code = String(form.get('warehouseCode') ?? '');
    const addressLine1 = String(form.get('warehouseAddress') ?? '');
    const city = String(form.get('warehouseCity') ?? '');
    const country = String(form.get('warehouseCountry') ?? '');
    onSubmit({
      defaultOriginCountry: String(form.get('defaultOriginCountry') ?? '') || undefined,
      defaultDestinationCountry: String(form.get('defaultDestinationCountry') ?? '') || undefined,
      warehouses: name && code && addressLine1 && city && country ? [{ name, code, addressLine1, city, country, isOriginWarehouse: true }] : undefined,
    });
  }
  return (
    <StepCard title="Operations" description="Your default shipping markets and first warehouse (you can add more later).">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-5">
          <TextInput label="Default origin country" id="defaultOriginCountry" name="defaultOriginCountry" />
          <TextInput label="Default destination country" id="defaultDestinationCountry" name="defaultDestinationCountry" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">First warehouse (optional)</p>
        <div className="grid grid-cols-2 gap-5">
          <TextInput label="Name" id="warehouseName" name="warehouseName" />
          <TextInput label="Code" id="warehouseCode" name="warehouseCode" placeholder="DFW-01" />
          <TextInput label="Address" id="warehouseAddress" name="warehouseAddress" />
          <TextInput label="City" id="warehouseCity" name="warehouseCity" />
          <TextInput label="Country" id="warehouseCountry" name="warehouseCountry" />
        </div>
        <Button type="submit" disabled={submitting} className="justify-center">
          {submitting ? 'Saving…' : 'Continue'}
        </Button>
      </form>
    </StepCard>
  );
}

function StaffStep({
  overview,
  submitting,
  onInvite,
  onContinue,
}: {
  overview: OnboardingOverview;
  submitting: boolean;
  onInvite: (input: { firstName: string; lastName: string; email: string; role: UserRole }) => void;
  onContinue: () => void;
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    onInvite({
      firstName: String(form.get('firstName') ?? ''),
      lastName: String(form.get('lastName') ?? ''),
      email: String(form.get('email') ?? ''),
      role: String(form.get('role') ?? '') as UserRole,
    });
    e.currentTarget.reset();
  }
  return (
    <StepCard title="Invite your team" description="Invite initial staff now, or skip and do this later. They'll set their own password from the invitation email.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="w-full sm:w-40">
          <TextInput label="First name" id="firstName" name="firstName" required />
        </div>
        <div className="w-full sm:w-40">
          <TextInput label="Last name" id="lastName" name="lastName" required />
        </div>
        <div className="flex-1">
          <TextInput label="Email" id="email" name="email" type="email" required />
        </div>
        <div className="w-48">
          <SelectInput label="Role" id="role" name="role" defaultValue={UserRole.WAREHOUSE_STAFF}>
            {INVITABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {role.replaceAll('_', ' ')}
              </option>
            ))}
          </SelectInput>
        </div>
        <Button type="submit" disabled={submitting} variant="secondary">
          Send Invite
        </Button>
      </form>

      {overview.invitations.length > 0 && (
        <ul className="mt-6 flex flex-col gap-2 text-sm text-slate-600">
          {overview.invitations.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <span>
                {inv.firstName} {inv.lastName} &middot; {inv.email}
              </span>
              <span className="text-xs uppercase text-slate-400">{inv.status}</span>
            </li>
          ))}
        </ul>
      )}

      <Button onClick={onContinue} disabled={submitting} className="mt-6 justify-center">
        Continue
      </Button>
    </StepCard>
  );
}

function TrackingStep({ submitting, onSubmit }: { submitting: boolean; onSubmit: (input: Parameters<typeof updateTracking>[0]) => void }) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    onSubmit({ trackingNumberPrefix: String(form.get('trackingNumberPrefix') ?? '').toUpperCase() || undefined });
  }
  return (
    <StepCard title="Tracking" description="Customize your shipment tracking number prefix.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextInput label="Tracking number prefix" id="trackingNumberPrefix" name="trackingNumberPrefix" placeholder="SHP" maxLength={10} />
        <Button type="submit" disabled={submitting} className="justify-center">
          {submitting ? 'Saving…' : 'Continue'}
        </Button>
      </form>
    </StepCard>
  );
}

function NotificationsStep({ submitting, onSubmit }: { submitting: boolean; onSubmit: (input: Parameters<typeof updateNotifications>[0]) => void }) {
  return (
    <StepCard title="Notifications" description="In-app and email notifications are on by default for your customers.">
      <div className="flex flex-col gap-3 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          <input type="checkbox" defaultChecked disabled className="h-4 w-4 rounded border-slate-300" /> In-App notifications
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" defaultChecked disabled className="h-4 w-4 rounded border-slate-300" /> Email notifications
        </label>
        <p className="text-xs text-slate-400">WhatsApp notifications are coming in a future update.</p>
      </div>
      <Button onClick={() => onSubmit({ emailEnabled: true, inAppEnabled: true })} disabled={submitting} className="mt-6 justify-center">
        Continue
      </Button>
    </StepCard>
  );
}

function BillingStep({ overview, submitting, onFinish }: { overview: OnboardingOverview; submitting: boolean; onFinish: () => void }) {
  const [portalLoading, setPortalLoading] = useState(false);
  const sub = overview.subscription;

  async function openBillingPortal() {
    setPortalLoading(true);
    try {
      const { url } = await createBillingPortalSession(window.location.href);
      window.location.href = url;
    } catch {
      setPortalLoading(false);
    }
  }

  return (
    <StepCard title="Billing" description="Your current plan and subscription status.">
      {sub ? (
        <div className="flex flex-col gap-2 text-sm text-slate-700">
          <p>
            <span className="font-semibold">Plan:</span> {sub.planName}
          </p>
          <p>
            <span className="font-semibold">Status:</span> {sub.status}
          </p>
          {sub.currentPeriodEnd && (
            <p>
              <span className="font-semibold">Next billing date:</span> {new Date(sub.currentPeriodEnd).toLocaleDateString()}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No billing account on file.</p>
      )}
      <Button onClick={openBillingPortal} disabled={portalLoading} variant="secondary" className="mt-4 justify-center">
        {portalLoading ? 'Opening…' : 'Manage Billing'}
      </Button>
      <Button onClick={onFinish} disabled={submitting} className="mt-3 justify-center">
        {submitting ? 'Finishing…' : 'Finish Setup'}
      </Button>
    </StepCard>
  );
}

function DoneStep() {
  return (
    <StepCard title="Your company is ready." description="Onboarding is complete — head to your dashboard.">
      <Button onClick={() => (window.location.href = '/dashboard')} className="justify-center">
        Go to Dashboard
      </Button>
    </StepCard>
  );
}
