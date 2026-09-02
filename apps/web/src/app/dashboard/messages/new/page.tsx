'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { AffectedCustomerPreviewItem, ContainerDetail, ManifestDetail } from '@transatlantic/shared';
import { DisruptionType } from '@transatlantic/shared';
import { SelectInput, TextArea } from '@/components/forms/FormField';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { listContainers } from '@/lib/containers';
import { humanizeEnumValue } from '@/lib/format';
import { listManifests } from '@/lib/manifests';
import { createDisruption, previewDisruption } from '@/lib/notifications';

type TargetKind = 'container' | 'manifest';

export default function NewDisruptionMessagePage() {
  const router = useRouter();

  const [targetKind, setTargetKind] = useState<TargetKind>('container');
  const [containers, setContainers] = useState<ContainerDetail[]>([]);
  const [manifests, setManifests] = useState<ManifestDetail[]>([]);
  const [targetId, setTargetId] = useState('');
  const [type, setType] = useState<DisruptionType>(DisruptionType.DELAYED);
  const [message, setMessage] = useState('');

  const [preview, setPreview] = useState<AffectedCustomerPreviewItem[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listContainers()
      .then(setContainers)
      .catch(() => setContainers([]));
    listManifests()
      .then(setManifests)
      .catch(() => setManifests([]));
  }, []);

  // Switching the target (container/manifest, or which one) invalidates
  // any prior preview — staff must always re-preview before sending, so a
  // stale "who will be notified" list can never be confirmed against.
  useEffect(() => {
    setPreview(null);
  }, [targetKind, targetId]);

  async function handlePreview() {
    if (!targetId) {
      setError(`Select a ${targetKind} first.`);
      return;
    }
    setError(null);
    setPreviewing(true);
    try {
      const affected = await previewDisruption(
        targetKind === 'container' ? { containerId: targetId } : { manifestId: targetId },
      );
      setPreview(affected);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load affected customers.');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!targetId) {
      setError(`Select a ${targetKind}.`);
      return;
    }
    if (!preview) {
      setError('Preview the affected customers before sending.');
      return;
    }
    if (message.trim().length < 5) {
      setError('Write a message customers will see (at least 5 characters).');
      return;
    }

    setSubmitting(true);
    try {
      await createDisruption({
        containerId: targetKind === 'container' ? targetId : undefined,
        manifestId: targetKind === 'manifest' ? targetId : undefined,
        type,
        message: message.trim(),
      });
      router.push('/dashboard/messages');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send disruption message.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">New Disruption Message</h1>
      <p className="mt-1 text-sm text-slate-500">
        Report a delayed, held, inspected, impounded, or otherwise disrupted container or manifest, and notify every
        affected customer at once.
      </p>

      <Card className="mt-6">
        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectInput
              label="Applies to"
              id="targetKind"
              value={targetKind}
              onChange={(event) => {
                setTargetKind(event.target.value as TargetKind);
                setTargetId('');
              }}
            >
              <option value="container">A container</option>
              <option value="manifest">A manifest</option>
            </SelectInput>
            {targetKind === 'container' ? (
              <SelectInput label="Container" id="containerId" required value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                <option value="">Select a container…</option>
                {containers.map((container) => (
                  <option key={container.id} value={container.id}>
                    {container.containerNumber}
                  </option>
                ))}
              </SelectInput>
            ) : (
              <SelectInput label="Manifest" id="manifestId" required value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                <option value="">Select a manifest…</option>
                {manifests.map((manifest) => (
                  <option key={manifest.id} value={manifest.id}>
                    {manifest.manifestNumber}
                  </option>
                ))}
              </SelectInput>
            )}
            <SelectInput label="Type" id="type" required value={type} onChange={(event) => setType(event.target.value as DisruptionType)}>
              {Object.values(DisruptionType).map((t) => (
                <option key={t} value={t}>
                  {humanizeEnumValue(t)}
                </option>
              ))}
            </SelectInput>
          </div>

          <TextArea
            label="Message to affected customers"
            id="message"
            rows={4}
            required
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="e.g. Your container has been selected for routine customs inspection. We expect a 3-5 day delay and will update you as soon as it clears."
          />
          <p className="-mt-3 text-xs text-slate-500">
            This is sent verbatim to every affected customer — write it as you would want them to read it, with no
            internal-only detail.
          </p>

          <div>
            <Button type="button" variant="secondary" onClick={handlePreview} disabled={previewing || !targetId}>
              {previewing ? 'Loading…' : 'Preview Affected Customers'}
            </Button>
          </div>

          {preview && (
            <div className="rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
                {preview.length === 0
                  ? 'No customers currently have items on this selection.'
                  : `${preview.length} customer${preview.length === 1 ? '' : 's'} will be notified`}
              </div>
              {preview.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {preview.map((customer) => (
                    <li key={customer.customerId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <div>
                        <div className="font-medium text-slate-900">{customer.customerName}</div>
                        <div className="font-mono text-xs text-slate-500">{customer.shipmentTrackingNumbers.join(', ')}</div>
                      </div>
                      <div className="flex gap-1.5">
                        <Badge variant="primary">In-App</Badge>
                        {customer.willNotifyByEmail && <Badge variant="neutral">Email</Badge>}
                        {customer.willNotifyBySms && <Badge variant="neutral">SMS</Badge>}
                        {customer.willNotifyByWhatsapp && <Badge variant="neutral">WhatsApp</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting || !preview} className="self-start">
            {submitting ? 'Sending…' : 'Send Disruption Message'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
