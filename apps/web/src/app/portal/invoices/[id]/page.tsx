'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PortalInvoiceDetail } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime, humanizeEnumValue } from '@/lib/format';
import { getPortalInvoiceDetail } from '@/lib/portal-invoices';

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-700">{value || '—'}</dd>
    </div>
  );
}

/**
 * Stage 3E: authenticated invoice detail. Fetches GET /portal/invoices/:id
 * (scoped server-side to this customer's own tenant + Customer record,
 * and to invoices that have actually been issued — see
 * CustomerPortalService/InvoicesService.findByIdForCustomer) and renders
 * it directly; no financial calculation happens in this component,
 * everything (subtotal/tax/total/amountPaid/balanceDue) is already
 * computed and formatted by the API. A DRAFT invoice, another customer's
 * invoice, and a genuinely nonexistent id all 404 identically
 * server-side; this page shows the same generic "not found" message for
 * any of them, never distinguishing.
 */
export default function PortalInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = params.id;

  const [invoice, setInvoice] = useState<PortalInvoiceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setInvoice(null);
    setNotFound(false);
    setError(false);
    getPortalInvoiceDetail(invoiceId)
      .then(setInvoice)
      .catch((err) => {
        if (err instanceof ApiError && err.statusCode === 404) {
          setNotFound(true);
        } else {
          setError(true);
        }
      });
  }, [invoiceId]);

  return (
    <div>
      <Link href="/portal/invoices" className="text-sm font-medium text-primary-700 hover:text-primary-800">
        ← Invoices
      </Link>

      {notFound && (
        <Card className="mt-4">
          <h1 className="text-base font-semibold text-slate-900">Invoice not found</h1>
          <p className="mt-2 text-sm text-slate-500">
            We couldn&apos;t find that invoice on your account. Double-check the link, or head back to{' '}
            <Link href="/portal/invoices" className="font-medium text-primary-700 hover:underline">
              Invoices
            </Link>
            .
          </p>
        </Card>
      )}

      {error && (
        <Card className="mt-4">
          <p className="text-sm text-red-600">
            We couldn&apos;t load this invoice right now. Please refresh the page, or contact us if this keeps
            happening.
          </p>
        </Card>
      )}

      {!notFound && !error && !invoice && (
        <div className="mt-4 flex flex-col gap-6">
          <div className="h-7 w-64 animate-pulse rounded bg-slate-200" />
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      )}

      {invoice && (
        <div className="mt-4 flex flex-col gap-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Invoice</p>
              <h1 className="mt-1 font-mono text-2xl font-semibold text-slate-900">{invoice.invoiceNumber}</h1>
              {invoice.shipmentTrackingNumber && (
                <p className="mt-1 font-mono text-sm text-slate-500">{invoice.shipmentTrackingNumber}</p>
              )}
            </div>
            <StatusBadge status={invoice.status} />
          </div>

          <Card>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Detail label="Invoice Date" value={formatDate(invoice.createdAt)} />
              <Detail label="Due Date" value={invoice.dueDate ? formatDate(invoice.dueDate) : '—'} />
              <Detail label="Currency" value={invoice.currency} />
              <Detail label="Issued" value={invoice.issuedAt ? formatDate(invoice.issuedAt) : '—'} />
            </dl>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-6 sm:grid-cols-4">
              <Detail label="Subtotal" value={formatCurrency(invoice.subtotal, invoice.currency)} />
              <Detail label="Tax" value={formatCurrency(invoice.tax, invoice.currency)} />
              <Detail label="Total" value={formatCurrency(invoice.total, invoice.currency)} />
              <Detail label="Amount Paid" value={formatCurrency(invoice.amountPaid, invoice.currency)} />
            </dl>
            <div className="mt-6 rounded-lg bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">Balance Due</span>
                <span className="text-lg font-semibold text-slate-900">
                  {formatCurrency(invoice.balanceDue, invoice.currency)}
                </span>
              </div>
            </div>
          </Card>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Line Items</h2>
            <Card className="mt-3 overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Quantity</th>
                    <th className="px-4 py-3 font-medium">Rate</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-slate-700">{item.description}</td>
                      <td className="px-4 py-3 text-slate-500">{item.quantity}</td>
                      <td className="px-4 py-3 text-slate-500">{formatCurrency(item.unitPrice, invoice.currency)}</td>
                      <td className="px-4 py-3 text-slate-900">{formatCurrency(item.amount, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900">Payments</h2>
            <Card className="mt-3 overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Method</th>
                    <th className="px-4 py-3 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-4 py-3 text-slate-500">
                        {payment.paidAt ? formatDateTime(payment.paidAt) : '—'}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {formatCurrency(payment.amount, payment.currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{humanizeEnumValue(payment.method)}</td>
                      <td className="px-4 py-3 text-slate-500">{payment.referenceNumber ?? '—'}</td>
                    </tr>
                  ))}
                  {invoice.payments.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                        No payments recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}
