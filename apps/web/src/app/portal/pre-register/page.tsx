'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PortalCustomerProfile, PreRegistrationFormFields } from '@transatlantic/shared';
import { PreRegistrationForm } from '@/components/portal/PreRegistrationForm';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getPortalProfile } from '@/lib/portal';
import { createPreRegistration, submitPreRegistration } from '@/lib/pre-registrations';

/**
 * Customer Self-Service Pre-Registration, Stage 2: "Prepare a Drop-Off" —
 * always starts a brand-new pre-registration (editing an existing DRAFT
 * happens on its own detail page, /portal/pre-registrations/[id]). Sender
 * identity is the logged-in customer's own profile, shown read-only here
 * and never re-collected — see PreRegistrationForm's own doc comment.
 */
export default function PrepareDropOffPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<PortalCustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getPortalProfile()
      .then(setProfile)
      .catch(() => setError('Failed to load your profile.'));
  }, []);

  async function handleSaveDraft(values: PreRegistrationFormFields) {
    setError(null);
    setSaving(true);
    try {
      const created = await createPreRegistration(values);
      router.push(`/portal/pre-registrations/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save your drop-off.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(values: PreRegistrationFormFields) {
    setError(null);
    setSubmitting(true);
    try {
      const created = await createPreRegistration(values);
      await submitPreRegistration(created.id);
      router.push(`/portal/pre-registrations/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit your drop-off.');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Prepare a Drop-Off</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tell us what to expect before you arrive. This is preliminary information only — our warehouse team
          will verify your package in person and issue the official tracking label when you drop it off.
        </p>
      </div>

      <Card>
        {profile && (
          <p className="mb-6 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Preparing this drop-off as <span className="font-medium text-slate-900">{profile.firstName} {profile.lastName}</span> (
            {profile.email})
          </p>
        )}

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <PreRegistrationForm onSaveDraft={handleSaveDraft} onSubmit={handleSubmit} saving={saving} submitting={submitting} />
      </Card>
    </div>
  );
}
