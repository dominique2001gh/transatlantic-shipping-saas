'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PortalInvoiceDetail } from '@transatlantic/shared';
import { PAYABLE_INVOICE_STATUSES, PaymentSource, PaymentStatus } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime, humanizeEnumValue } from '@/lib/format';
import { createPortalInvoiceCheckoutSession, getPortalInvoiceDetail } from '@/lib/portal-invoices';

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
 *
 * Stage 3F adds "Pay Now" (visible only while a balance is actually
 * payable — see PAYABLE_INVOICE_STATUSES, a UI convenience only; the
 * backend re-checks this itself) and handling for the return from
 * Stripe's hosted Checkout (?payment=success|cancelled). The redirect
 * back from Stripe can land before its webhook has finished updating the
 * invoice — this page never trusts the redirect outcome by itself, it
 * polls GET /portal/invoices/:id a few times (bounded, short interval)
 * until no PENDING online payment remains against this invoice, so what's
 * shown always reflects the server's actual, webhook-confirmed state.
 */
export default function PortalInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = params.id;
  const searchParams = useSearchParams();
  const paymentResult = searchParams.get('payment'); // 'success' | 'cancelled' | null

  const [invoice, setInvoice] = useState<PortalInvoiceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [payingNow, setPayingNow] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInvoice(null);
    setNotFound(false);
    setError(false);

    async function run() {
      // Only the post-checkout-success return polls; every other visit
      // (including a plain page load or the cancelled return) fetches
      // exactly once, same as before Stage 3F.
      const maxAttempts = paymentResult === 'success' ? 5 : 1;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (cancelled) return;
        try {
          const data = await getPortalInvoiceDetail(invoiceId);
          if (cancelled) return;
          setInvoice(data);
          const stillPending = data.payments.some(
            (payment) => payment.source === PaymentSource.ONLINE && payment.status === PaymentStatus.PENDING,
          );
          if (!stillPending) return;
        } catch (err) {
          if (cancelled) return;
          if (err instanceof ApiError && err.statusCode === 404) {
            setNotFound(true);
          } else {
            setError(true);
          }
          return;
        }
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, paymentResult]);

  async function handlePayNow() {
    setPayingNow(true);
    setPayError(null);
    try {
      const { url } = await createPortalInvoiceCheckoutSession(invoiceId);
      // Full-page navigation, deliberately — this hands off to Stripe's
      // own hosted page; there is nothing left for this app to render
      // until Stripe redirects back.
      window.location.href = url;
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Unable to start checkout. Please try again.');
      setPayingNow(false);
    }
  }

  const canPayOnline =
    !!invoice &&
    PAYABLE_INVOICE_STATUSES.includes(invoice.status) &&
    Number.parseFloat(invoice.balanceDue) > 0;
  const awaitingConfirmation =
    paymentResult === 'success' &&
    !!invoice?.payments.some((payment) => payment.source === PaymentSource.ONLINE && payment.status === PaymentStatus.PENDING);

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
            <div className="flex items-center gap-3">
              <StatusBadge status={invoice.status} />
              {canPayOnline && (
                <Button onClick={handlePayNow} disabled={payingNow}>
                  {payingNow ? 'Starting checkout…' : 'Pay Now'}
                </Button>
              )}
            </div>
          </div>

          {paymentResult === 'success' && awaitingConfirmation && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Finalizing your payment — this can take a few seconds. This page will update automatically.
            </p>
          )}
          {paymentResult === 'success' && !awaitingConfirmation && (
            <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Payment received — thank you!
            </p>
          )}
          {paymentResult === 'cancelled' && (
            <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
              Checkout was cancelled — no payment was made.
            </p>
          )}
          {payError && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{payError}</p>}

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
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.payments
                    .filter((payment) => payment.status === PaymentStatus.COMPLETED)
                    .map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-4 py-3 text-slate-500">
                          {payment.paidAt ? formatDateTime(payment.paidAt) : '—'}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {formatCurrency(payment.amount, payment.currency)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{humanizeEnumValue(payment.method)}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {payment.source === PaymentSource.ONLINE ? 'Online' : 'Recorded by staff'}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{payment.referenceNumber ?? '—'}</td>
                      </tr>
                    ))}
                  {invoice.payments.filter((payment) => payment.status === PaymentStatus.COMPLETED).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
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
