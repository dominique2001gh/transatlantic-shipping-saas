'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CustomerSummary, ShipmentSummary } from '@transatlantic/shared';
import { DocumentType } from '@transatlantic/shared';
import { SelectInput, TextArea } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { listCustomers } from '@/lib/customers';
import { uploadDocumentForCustomer, uploadDocumentForShipment } from '@/lib/documents';
import { humanizeEnumValue } from '@/lib/format';
import { listShipments } from '@/lib/shipments';

export default function NewDocumentPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [shipments, setShipments] = useState<ShipmentSummary[]>([]);
  const [shipmentId, setShipmentId] = useState('');
  const [type, setType] = useState<DocumentType>(DocumentType.BILL_OF_LADING);
  const [description, setDescription] = useState('');
  const [visibleToCustomer, setVisibleToCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, []);

  // Same "only ever offer what's already valid for the selected customer"
  // UX convenience as /dashboard/invoices/new — the backend independently
  // re-validates regardless (DocumentsService.uploadForShipment derives
  // customerId from the shipment itself, never trusting this form).
  useEffect(() => {
    setShipmentId('');
    if (!customerId) {
      setShipments([]);
      return;
    }
    listShipments({ customerId })
      .then(setShipments)
      .catch(() => setShipments([]));
  }, [customerId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const file = fileInputRef.current?.files?.[0];
    if (!customerId) {
      setError('Select a customer.');
      return;
    }
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }

    setSubmitting(true);
    try {
      const input = { file, type, description: description || undefined, visibleToCustomer };
      const doc = shipmentId
        ? await uploadDocumentForShipment(shipmentId, input)
        : await uploadDocumentForCustomer(customerId, input);
      router.push(`/dashboard/documents?uploaded=${doc.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload document.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Upload Document</h1>
      <p className="mt-1 text-sm text-slate-500">
        Attach a file to a customer or one of their shipments. Only PDF, PNG, and JPEG are accepted, up to 20MB.
      </p>

      <Card className="mt-6">
        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectInput
              label="Customer"
              id="customerId"
              required
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Select a customer…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.customerNumber} — {customer.firstName} {customer.lastName}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Shipment (optional)"
              id="shipmentId"
              disabled={!customerId}
              value={shipmentId}
              onChange={(event) => setShipmentId(event.target.value)}
            >
              <option value="">{customerId ? 'Not tied to a specific shipment' : 'Select a customer first'}</option>
              {shipments.map((shipment) => (
                <option key={shipment.id} value={shipment.id}>
                  {shipment.trackingNumber}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Document type"
              id="type"
              required
              value={type}
              onChange={(event) => setType(event.target.value as DocumentType)}
            >
              {Object.values(DocumentType).map((docType) => (
                <option key={docType} value={docType}>
                  {humanizeEnumValue(docType)}
                </option>
              ))}
            </SelectInput>
            <div>
              <label htmlFor="file" className="block text-sm font-medium text-slate-700">
                File <span className="text-primary-600">*</span>
              </label>
              <input
                id="file"
                name="file"
                type="file"
                required
                ref={fileInputRef}
                accept="application/pdf,image/png,image/jpeg"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>

          <TextArea
            label="Description (optional)"
            id="description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder='e.g. "Bill of Lading — Container ABC123"'
          />

          <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={visibleToCustomer}
              onChange={(event) => setVisibleToCustomer(event.target.checked)}
            />
            <span>
              <span className="font-medium text-slate-900">Visible to the customer</span>
              <span className="mt-0.5 block text-slate-500">
                Off by default. Leave unchecked to keep this document staff-only — it can be made visible later from
                the documents list.
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="self-start">
            {submitting ? 'Uploading…' : 'Upload Document'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
