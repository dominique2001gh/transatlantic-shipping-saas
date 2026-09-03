'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { InvoiceSummary, PortalDocumentSummary, PortalShipmentDetail } from '@transatlantic/shared';
import { IconArrowRight } from '@/components/icons';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { TrackingResult } from '@/components/marketing/TrackingResult';
import { Card } from '@/components/ui/Card';
import { LinkButton } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDate, humanizeEnumValue } from '@/lib/format';
import { getPortalShipmentDetail } from '@/lib/portal';
import { downloadPortalDocument, getPortalDocuments } from '@/lib/portal-documents';
import { getPortalInvoices } from '@/lib/portal-invoices';
import { SHIPMENT_MODE_LABELS } from '@/lib/quote';

/**
 * Stage 2C-4: authenticated shipment detail. Fetches GET
 * /portal/shipments/:id (already scoped server-side to this customer's own
 * tenant + Customer record — see CustomerPortalService/
 * TrackingService.getForCustomer) and renders it with the exact same
 * <TrackingResult> component the public /track page uses for Stage 2A/2B —
 * one shared, customer-safe tracking presentation, not a second
 * interpretation of it. PortalShipmentDetail is a strict superset of
 * PublicTrackingResult (adds `id` and `shipmentMode`, both ignored by
 * TrackingResult), so no adapter/mapping is needed.
 *
 * A shipment that doesn't exist and one that exists but belongs to another
 * customer/tenant both 404 identically server-side; this page renders the
 * same generic "not found" message for either case, never distinguishing
 * them.
 *
 * Stage 3J: Related Documents/Invoices below are derived by filtering the
 * caller's own already-fully-scoped GET /portal/documents and
 * GET /portal/invoices lists down to this shipment's id — both
 * InvoiceSummary and PortalDocumentSummary already carry shipmentId (see
 * their own doc comments in @transatlantic/shared), so no new backend
 * endpoint or query was needed. Fetched in a separate effect, only once
 * the shipment itself has successfully loaded, and with its own isolated
 * error state — a transient failure loading documents/invoices must never
 * blank out the tracking view above it, which already loaded fine.
 */
export default function PortalShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const shipmentId = params.id;

  const [detail, setDetail] = useState<PortalShipmentDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  const [relatedDocuments, setRelatedDocuments] = useState<PortalDocumentSummary[] | null>(null);
  const [relatedInvoices, setRelatedInvoices] = useState<InvoiceSummary[] | null>(null);
  const [relatedError, setRelatedError] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

  useEffect(() => {
    setDetail(null);
    setNotFound(false);
    setError(false);
    getPortalShipmentDetail(shipmentId)
      .then(setDetail)
      .catch((err) => {
        if (err instanceof ApiError && err.statusCode === 404) {
          setNotFound(true);
        } else {
          setError(true);
        }
      });
  }, [shipmentId]);

  useEffect(() => {
    if (!detail) return;
    setRelatedDocuments(null);
    setRelatedInvoices(null);
    setRelatedError(false);
    Promise.all([getPortalDocuments(), getPortalInvoices()])
      .then(([documents, invoices]) => {
        setRelatedDocuments(documents.filter((doc) => doc.shipmentId === shipmentId));
        setRelatedInvoices(invoices.filter((invoice) => invoice.shipmentId === shipmentId));
      })
      .catch(() => setRelatedError(true));
    // `detail` (not just shipmentId) is the trigger — this must only ever
    // run after the shipment itself is confirmed to belong to this
    // customer, never speculatively in parallel with a request that might
    // still 404.
  }, [detail, shipmentId]);

  return (
    <div>
      <Link href="/portal/shipments" className="text-sm font-medium text-primary-700 hover:text-primary-800">
        ← My Shipments
      </Link>

      {notFound && (
        <Card className="mt-4">
          <h1 className="text-base font-semibold text-slate-900">Shipment not found</h1>
          <p className="mt-2 text-sm text-slate-500">
            We couldn&apos;t find that shipment on your account. Double-check the link, or head back to{' '}
            <Link href="/portal/shipments" className="font-medium text-primary-700 hover:underline">
              My Shipments
            </Link>
            .
          </p>
        </Card>
      )}

      {error && (
        <Card className="mt-4">
          <p className="text-sm text-red-600">
            We couldn&apos;t load this shipment right now. Please refresh the page, or contact us if this keeps
            happening.
          </p>
        </Card>
      )}

      {!notFound && !error && !detail && (
        <div className="mt-4">
          <div className="h-7 w-64 animate-pulse rounded bg-slate-200" />
          <div className="mt-6 h-40 animate-pulse rounded-2xl bg-slate-100" />
          <div className="mt-6 h-56 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      )}

      {detail && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-semibold text-slate-900">{SHIPMENT_MODE_LABELS[detail.shipmentMode]}</span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="text-slate-500">Created {formatDate(detail.createdAt)}</span>
          </div>
          <TrackingResult result={detail} />

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Related Documents</h2>
                <LinkButton href="/portal/documents" variant="ghost" size="sm">
                  All documents
                  <IconArrowRight className="h-4 w-4" />
                </LinkButton>
              </div>
              {relatedError && <p className="mt-3 text-sm text-red-600">Couldn&apos;t load documents right now.</p>}
              {!relatedError && !relatedDocuments && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
                </div>
              )}
              {!relatedError && relatedDocuments && relatedDocuments.length === 0 && (
                <p className="mt-3 text-sm text-slate-500">No documents shared for this shipment yet.</p>
              )}
              {!relatedError && relatedDocuments && relatedDocuments.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100">
                  {relatedDocuments.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{doc.fileName}</p>
                        <p className="text-xs text-slate-500">{humanizeEnumValue(doc.type)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownload(doc)}
                        disabled={downloadingId === doc.id}
                        className="shrink-0 text-xs font-semibold text-primary-700 hover:text-primary-800 disabled:opacity-50"
                      >
                        {downloadingId === doc.id ? 'Downloading…' : 'Download'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {downloadError && <p className="mt-3 text-sm text-red-600">{downloadError}</p>}
            </Card>

            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Related Invoices</h2>
                <LinkButton href="/portal/invoices" variant="ghost" size="sm">
                  All invoices
                  <IconArrowRight className="h-4 w-4" />
                </LinkButton>
              </div>
              {relatedError && <p className="mt-3 text-sm text-red-600">Couldn&apos;t load invoices right now.</p>}
              {!relatedError && !relatedInvoices && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
                </div>
              )}
              {!relatedError && relatedInvoices && relatedInvoices.length === 0 && (
                <p className="mt-3 text-sm text-slate-500">No invoices issued for this shipment yet.</p>
              )}
              {!relatedError && relatedInvoices && relatedInvoices.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100">
                  {relatedInvoices.map((invoice) => (
                    <li key={invoice.id} className="py-2.5">
                      <Link
                        href={`/portal/invoices/${invoice.id}`}
                        className="flex items-center justify-between gap-3 hover:opacity-80"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm font-medium text-slate-900">
                            {invoice.invoiceNumber}
                          </p>
                          <p className="text-xs text-slate-500">
                            Balance: {formatCurrency(invoice.balanceDue, invoice.currency)}
                          </p>
                        </div>
                        <StatusBadge status={invoice.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
