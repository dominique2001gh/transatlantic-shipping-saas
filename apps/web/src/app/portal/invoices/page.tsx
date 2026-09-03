'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { InvoiceSummary } from '@transatlantic/shared';
import { IconBox } from '@/components/icons';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Card } from '@/components/ui/Card';
import { formatCurrency, formatDate } from '@/lib/format';
import { getPortalInvoices } from '@/lib/portal-invoices';

/**
 * Stage 3E: the customer's own issued invoices — GET /portal/invoices
 * already excludes DRAFT invoices and is scoped server-side to this
 * customer's own tenant + Customer record; this page does no filtering
 * of its own. Same loading/empty/error treatment as the other portal
 * pages (see /portal/shipments) for visual consistency.
 */
export default function PortalInvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getPortalInvoices()
      .then(setInvoices)
      .catch(() => setError(true));
  }, []);

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
        <p className="mt-1 text-sm text-slate-500">Invoices issued for your shipments, and their payment status.</p>
      </div>

      <Card className="mt-6 p-0">
        {error && (
          <p className="p-6 text-sm text-red-600">
            We couldn&apos;t load your invoices right now. Please refresh the page, or contact us if this keeps
            happening.
          </p>
        )}

        {!error && !invoices && (
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

        {!error && invoices && invoices.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
              <IconBox className="h-6 w-6" />
            </span>
            <h2 className="mt-2 text-base font-semibold text-slate-900">No invoices yet</h2>
            <p className="max-w-sm px-6 text-sm text-slate-500">
              Once your shipping company issues an invoice for one of your shipments, it will show up here.
            </p>
          </div>
        )}

        {!error && invoices && invoices.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Invoice #</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Shipment</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Invoice Date</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Due Date</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Total</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Paid</th>
                  <th className="px-4 py-3 font-medium">Balance</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">
                      <Link href={`/portal/invoices/${invoice.id}`} className="hover:text-primary-700">
                        {invoice.invoiceNumber}
                      </Link>
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-slate-500 sm:table-cell">
                      {invoice.shipmentTrackingNumber ?? '—'}
                    </td>
                    <td className="hidden px-4 py-3 text-slate-500 md:table-cell">{formatDate(invoice.createdAt)}</td>
                    <td className="hidden px-4 py-3 text-slate-500 md:table-cell">
                      {invoice.dueDate ? formatDate(invoice.dueDate) : '—'}
                    </td>
                    <td className="hidden px-4 py-3 text-slate-900 sm:table-cell">
                      {formatCurrency(invoice.total, invoice.currency)}
                    </td>
                    <td className="hidden px-4 py-3 text-slate-500 md:table-cell">
                      {formatCurrency(invoice.amountPaid, invoice.currency)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {formatCurrency(invoice.balanceDue, invoice.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={invoice.status} />
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
