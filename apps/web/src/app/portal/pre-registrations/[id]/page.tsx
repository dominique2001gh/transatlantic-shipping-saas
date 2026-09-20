'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { PortalPreRegistration, PreRegistrationFormFields } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { PreRegistrationForm } from '@/components/portal/PreRegistrationForm';
import { PreRegistrationQr } from '@/components/portal/PreRegistrationQr';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cancelPreRegistration, getPreRegistration, submitPreRegistration, updatePreRegistration } from '@/lib/pre-registrations';

/** Read-only recap of the shipment/recipient details, shared by every non-editable status view below. */
function DropOffSummary({ record }: { record: PortalPreRegistration }) {
  const allRows: Array<[string, string | null | undefined]> = [
    ['Recipient', record.recipientName],
    ['Recipient phone', record.recipientPhone],
    ['Destination', [record.destinationLocation, record.destinationCountry].filter(Boolean).join(', ') || null],
    ['Shipping mode', record.shipmentMode ?? null],
    ['Package type', record.itemType ?? null],
    ['Pieces', record.packageCount ? String(record.packageCount) : null],
    ['Description', record.description],
    ['Notes', record.notes],
  ];
  const rows = allRows.filter(([, value]) => !!value);

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No additional details were provided.</p>;
  }

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-slate-500">{label}</dt>
          <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function PreRegistrationDetailPage() {
  const params = useParams<{ id: string }>();
  const [record, setRecord] = useState<PortalPreRegistration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  function reload() {
    getPreRegistration(params.id)
      .then(setRecord)
      .catch((err) => {
        if (err instanceof ApiError && err.statusCode === 404) {
          setNotFound(true);
        } else {
          setError('Failed to load this drop-off.');
        }
      });
  }

  useEffect(reload, [params.id]);

  async function handleSaveDraft(values: PreRegistrationFormFields) {
    if (!record) return;
    setError(null);
    setSaving(true);
    try {
      setRecord(await updatePreRegistration(record.id, values));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save your changes.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(values: PreRegistrationFormFields) {
    if (!record) return;
    setError(null);
    setSubmitting(true);
    try {
      await updatePreRegistration(record.id, values);
      setRecord(await submitPreRegistration(record.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit your drop-off.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!record) return;
    if (!window.confirm('Cancel this prepared drop-off? You can prepare a new one at any time.')) return;
    setCancelling(true);
    setError(null);
    try {
      setRecord(await cancelPreRegistration(record.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel this drop-off.');
    } finally {
      setCancelling(false);
    }
  }

  if (notFound) {
    return (
      <Card>
        <p className="text-sm text-slate-600">We couldn&apos;t find that prepared drop-off.</p>
        <Link href="/portal/pre-registrations" className="mt-3 inline-block text-sm font-semibold text-primary-700">
          Back to Prepared Drop-Offs
        </Link>
      </Card>
    );
  }

  if (!record) {
    return (
      <Card>
        <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {record.referenceNumber ?? 'Draft Drop-Off'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Created {formatDateTime(record.createdAt)}</p>
        </div>
        <StatusBadge status={record.status} />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {record.status === 'DRAFT' && (
        <Card>
          <p className="mb-6 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            This drop-off is still a draft — nothing has been sent to the warehouse yet.
          </p>
          <PreRegistrationForm
            initialValues={record}
            onSaveDraft={handleSaveDraft}
            onSubmit={handleSubmit}
            saving={saving}
            submitting={submitting}
            saveLabel="Save Changes"
          />
          <div className="mt-4 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              className="text-sm font-medium text-red-600 hover:text-red-700"
            >
              {cancelling ? 'Discarding…' : 'Discard this draft'}
            </button>
          </div>
        </Card>
      )}

      {record.status === 'SUBMITTED' && record.referenceNumber && (
        <>
          <Card>
            <PreRegistrationQr referenceNumber={record.referenceNumber} />
            <div className="mt-4 flex flex-col gap-1 text-center text-sm text-slate-600">
              <p className="font-medium text-slate-900">Your package has not yet been received.</p>
              <p>Warehouse staff will verify your package and issue the official tracking label when you drop it off.</p>
            </div>
          </Card>
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Drop-off details</h2>
            <DropOffSummary record={record} />
            <div className="mt-6 border-t border-slate-100 pt-4">
              <Button type="button" variant="secondary" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Cancel this drop-off'}
              </Button>
            </div>
          </Card>
        </>
      )}

      {(record.status === 'CONVERTED' || record.status === 'CANCELLED' || record.status === 'EXPIRED') && (
        <Card>
          {record.status === 'CONVERTED' && (
            <p className="mb-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              This drop-off has been received at the warehouse and is now part of your shipments.
            </p>
          )}
          {record.status === 'CANCELLED' && (
            <p className="mb-6 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">This drop-off was cancelled.</p>
          )}
          {record.status === 'EXPIRED' && (
            <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This drop-off expired before it reached the warehouse. Prepare a new one if you still plan to ship it.
            </p>
          )}
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Drop-off details</h2>
          <DropOffSummary record={record} />
        </Card>
      )}
    </div>
  );
}
