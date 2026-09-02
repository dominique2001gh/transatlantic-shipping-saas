'use client';

import { useEffect, useState } from 'react';
import type { PortalDocumentSummary } from '@transatlantic/shared';
import { IconBox } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatDate, formatFileSize, humanizeEnumValue } from '@/lib/format';
import { downloadPortalDocument, getPortalDocuments } from '@/lib/portal-documents';

/**
 * Stage 3G: the customer's own visible documents — GET /portal/documents
 * already excludes staff-only documents and is scoped server-side to this
 * customer's own tenant + Customer record; this page does no filtering of
 * its own. Same loading/empty/error treatment as the other portal pages
 * (see /portal/invoices) for visual consistency.
 */
export default function PortalDocumentsPage() {
  const [documents, setDocuments] = useState<PortalDocumentSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    getPortalDocuments()
      .then(setDocuments)
      .catch(() => setError(true));
  }, []);

  async function handleDownload(doc: PortalDocumentSummary) {
    setDownloadingId(doc.id);
    setDownloadError(null);
    try {
      await downloadPortalDocument(doc);
    } catch {
      setDownloadError('Could not download that document right now. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Documents</h1>
        <p className="mt-1 text-sm text-slate-500">
          Bills of lading, customs forms, and other documents your shipping company has shared with you.
        </p>
      </div>

      {downloadError && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{downloadError}</p>}

      <Card className="mt-6 p-0">
        {error && (
          <p className="p-6 text-sm text-red-600">
            We couldn&apos;t load your documents right now. Please refresh the page, or contact us if this keeps
            happening.
          </p>
        )}

        {!error && !documents && (
          <div className="divide-y divide-slate-100 px-4 sm:px-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-4">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-100" />
                <div className="flex-1">
                  <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
                  <div className="mt-2 h-3 w-56 animate-pulse rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!error && documents && documents.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <IconBox className="h-6 w-6" />
            </span>
            <h2 className="mt-2 text-base font-semibold text-slate-900">No documents yet</h2>
            <p className="max-w-sm px-6 text-sm text-slate-500">
              Once your shipping company shares a document for one of your shipments, it will show up here.
            </p>
          </div>
        )}

        {!error && documents && documents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Document</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Shipment</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Size</th>
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
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{doc.shipmentTrackingNumber ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(doc.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatFileSize(doc.fileSizeBytes)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDownload(doc)}
                        disabled={downloadingId === doc.id}
                      >
                        {downloadingId === doc.id ? 'Downloading…' : 'Download'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
