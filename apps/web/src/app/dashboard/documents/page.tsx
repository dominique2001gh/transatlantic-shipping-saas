'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DocumentSummary } from '@transatlantic/shared';
import { DocumentType } from '@transatlantic/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { downloadDocument, listDocuments, updateDocument } from '@/lib/documents';
import { formatDate, formatFileSize, humanizeEnumValue } from '@/lib/format';

const TYPE_FILTERS: { label: string; value: DocumentType | '' }[] = [
  { label: 'All types', value: '' },
  ...Object.values(DocumentType).map((type) => ({ label: humanizeEnumValue(type), value: type })),
];

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<DocumentType | ''>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    listDocuments(typeFilter ? { type: typeFilter } : undefined)
      .then(setDocuments)
      .catch((err) => {
        setError(
          err instanceof ApiError && err.statusCode === 403
            ? "You don't have permission to view documents."
            : err instanceof ApiError
              ? err.message
              : 'Failed to load documents.',
        );
      });
  }

  useEffect(reload, [typeFilter]);

  async function handleDownload(doc: DocumentSummary) {
    setBusyId(doc.id);
    try {
      await downloadDocument(doc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Download failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleVisibility(doc: DocumentSummary) {
    const makingVisible = !doc.visibleToCustomer;
    const confirmed = window.confirm(
      makingVisible
        ? `Make "${doc.fileName}" visible to the customer? They will be able to see and download it from their portal.`
        : `Hide "${doc.fileName}" from the customer? They will no longer be able to see or download it from their portal.`,
    );
    if (!confirmed) return;

    setBusyId(doc.id);
    try {
      const updated = await updateDocument(doc.id, { visibleToCustomer: makingVisible });
      setDocuments((prev) => prev?.map((d) => (d.id === doc.id ? updated : d)) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update visibility.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Documents</h1>
          <p className="mt-1 text-sm text-slate-500">
            Bills of lading, customs forms, and other files attached to a customer or shipment.
          </p>
        </div>
        <Link href="/dashboard/documents/new">
          <Button>Upload Document</Button>
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as DocumentType | '')}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {TYPE_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <Card className="mt-4 overflow-x-auto p-0">
        {error && <p className="p-6 text-sm text-red-600">{error}</p>}
        {!error && !documents && <p className="p-6 text-sm text-slate-500">Loading…</p>}
        {!error && documents && documents.length === 0 && <p className="p-6 text-sm text-slate-500">No documents yet.</p>}
        {!error && documents && documents.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Shipment</th>
                <th className="px-4 py-3 font-medium">Uploaded</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Visibility</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-900">
                    <div className="font-medium">{doc.fileName}</div>
                    {doc.description && <div className="mt-0.5 text-xs text-slate-500">{doc.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{humanizeEnumValue(doc.type)}</td>
                  <td className="px-4 py-3 text-slate-700">{doc.customerName ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{doc.shipmentTrackingNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(doc.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-500">{formatFileSize(doc.fileSizeBytes)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggleVisibility(doc)}
                      disabled={busyId === doc.id}
                      title={
                        doc.visibleToCustomer
                          ? 'Click to hide this document from the customer'
                          : 'Click to make this document visible to the customer'
                      }
                      aria-label={
                        doc.visibleToCustomer
                          ? 'Customer-visible. Click to hide from customer.'
                          : 'Staff-only. Click to make visible to customer.'
                      }
                      className="cursor-pointer rounded-full transition hover:ring-2 hover:ring-primary-300 hover:ring-offset-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Badge variant={doc.visibleToCustomer ? 'success' : 'neutral'}>
                        {doc.visibleToCustomer ? 'Customer-visible' : 'Staff-only'}
                      </Badge>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="secondary" size="sm" onClick={() => handleDownload(doc)} disabled={busyId === doc.id}>
                      Download
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
