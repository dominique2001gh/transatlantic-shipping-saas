'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReceivingRecordSummary } from '@transatlantic/shared';
import { ReceivingLabel } from '@/components/receiving/ReceivingLabel';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { getReceivingRecord } from '@/lib/receiving';
import { useTenant } from '@/lib/useTenant';

export default function ReceivingLabelPage() {
  const params = useParams<{ id: string }>();
  const [record, setRecord] = useState<ReceivingRecordSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { tenantName } = useTenant(true);

  useEffect(() => {
    getReceivingRecord(params.id)
      .then(setRecord)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load this receiving record.'));
  }, [params.id]);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!record) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Internal Receiving Label — {record.internalReference}</h1>
          <p className="mt-1 text-sm text-slate-500">
            For internal warehouse identification only — never scanned into the shipment, container, or manifest flow.
          </p>
        </div>
        <Button onClick={() => window.print()}>Print Label</Button>
      </div>

      <div className="label-sheet">
        <ReceivingLabel
          data={{
            internalReference: record.internalReference,
            carrier: record.carrier === 'OTHER' ? record.carrierOther ?? 'Other' : record.carrier,
            carrierTrackingNumber: record.carrierTrackingNumber,
            customerName: record.customerName ?? 'Unknown customer',
            description: record.description,
            quantity: record.quantity,
            companyName: tenantName ?? 'Shipping Company',
          }}
        />
      </div>
    </div>
  );
}
