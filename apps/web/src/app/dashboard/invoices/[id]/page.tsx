'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { InvoiceDetail, PaymentSummary } from '@transatlantic/shared';
import { InvoiceStatus, PaymentMethod } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { SelectInput, TextArea, TextInput } from '@/components/forms/FormField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime, humanizeEnumValue } from '@/lib/format';
import { getInvoice, issueInvoice } from '@/lib/invoices';
import { listPaymentsForInvoice, recordPayment } from '@/lib/payments';

/** Excludes CARD on purpose — reserved for a future online-payment flow, not manual staff recording (see Stage 3B/3D scope). */
const MANUAL_PAYMENT_METHODS = [
  PaymentMethod.CASH,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.MOBILE_MONEY,
  PaymentMethod.CHECK,
  PaymentMethod.OTHER,
];

/** Invoice statuses that can still accept a payment — mirrors PaymentsService's PAYABLE_STATUSES exactly, but this is purely a UI convenience; the backend is the real authority (see recordPayment's own error handling below). */
const PAYABLE_STATUSES = new Set<InvoiceStatus>([InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE]);

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-700">{value || '—'}</dd>
    </div>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = params.id;

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [payments, setPayments] = useState<PaymentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [invoiceData, paymentsData] = await Promise.all([
        getInvoice(invoiceId),
        listPaymentsForInvoice(invoiceId),
      ]);
      setInvoice(invoiceData);
      setPayments(paymentsData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load invoice.');
    }
  }, [invoiceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleIssue() {
    setIssuing(true);
    setNotice(null);
    try {
      await issueInvoice(invoiceId);
      setNotice('Invoice issued — it is now visible to the customer once portal invoice viewing is available.');
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to issue invoice.');
    } finally {
      setIssuing(false);
    }
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!invoice) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Invoice</p>
          <h1 className="mt-1 font-mono text-2xl font-semibold text-slate-900">{invoice.invoiceNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">
            <Link href={`/dashboard/customers/${invoice.customerId}`} className="hover:text-primary-700">
              {invoice.customerName}
            </Link>
            {invoice.shipmentId && (
              <>
                {' · '}
                <Link href={`/dashboard/shipments/${invoice.shipmentId}`} className="font-mono hover:text-primary-700">
                  {invoice.shipmentTrackingNumber}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={invoice.status} />
          {invoice.status === InvoiceStatus.DRAFT && (
            <Button onClick={handleIssue} disabled={issuing}>
              {issuing ? 'Issuing…' : 'Issue Invoice'}
            </Button>
          )}
        </div>
      </div>

      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}

      <Card>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Detail label="Invoice Date" value={formatDate(invoice.createdAt)} />
          <Detail label="Due Date" value={invoice.dueDate ? formatDate(invoice.dueDate) : '—'} />
          <Detail label="Currency" value={invoice.currency} />
          <Detail label="Issued" value={invoice.issuedAt ? formatDate(invoice.issuedAt) : 'Not yet issued'} />
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
                <th className="px-4 py-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(payments ?? []).map((payment) => (
                <tr key={payment.id}>
                  <td className="px-4 py-3 text-slate-500">{payment.paidAt ? formatDateTime(payment.paidAt) : '—'}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {formatCurrency(payment.amount, payment.currency)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{humanizeEnumValue(payment.method)}</td>
                  <td className="px-4 py-3 text-slate-500">{payment.referenceNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{payment.notes ?? '—'}</td>
                </tr>
              ))}
              {payments && payments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                    No payments recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <div className="mt-4">
          {PAYABLE_STATUSES.has(invoice.status) ? (
            <RecordPaymentForm invoice={invoice} onRecorded={reload} />
          ) : (
            <Card className="text-sm text-slate-500">
              {invoice.status === InvoiceStatus.DRAFT && 'Issue this invoice before recording a payment.'}
              {invoice.status === InvoiceStatus.PAID && 'This invoice is already fully paid.'}
              {invoice.status === InvoiceStatus.VOID && 'This invoice has been voided and can no longer accept payments.'}
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}

function RecordPaymentForm({ invoice, onRecorded }: { invoice: InvoiceDetail; onRecorded: () => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [paidAt, setPaidAt] = useState(today);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const balanceDue = Number(invoice.balanceDue);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!amount || Number.isNaN(value) || value <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (value > balanceDue) {
      setError(`Amount cannot exceed the balance due (${formatCurrency(invoice.balanceDue, invoice.currency)}).`);
      return;
    }

    setSubmitting(true);
    try {
      await recordPayment(invoice.id, {
        amount: value,
        method,
        referenceNumber: referenceNumber || undefined,
        paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
        notes: notes || undefined,
      });
      setAmount('');
      setReferenceNumber('');
      setNotes('');
      await onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record payment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-900">Record a Payment</h3>
      <p className="mt-1 text-sm text-slate-500">
        Balance due: <span className="font-medium text-slate-900">{formatCurrency(invoice.balanceDue, invoice.currency)}</span>{' '}
        of {formatCurrency(invoice.total, invoice.currency)} total ({formatCurrency(invoice.amountPaid, invoice.currency)}{' '}
        already paid).
      </p>
      <form className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={handleSubmit} noValidate>
        <TextInput
          label={`Amount (${invoice.currency})`}
          id="paymentAmount"
          type="number"
          min={0.01}
          max={balanceDue}
          step="0.01"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <SelectInput
          label="Method"
          id="paymentMethod"
          required
          value={method}
          onChange={(event) => setMethod(event.target.value as PaymentMethod)}
        >
          {MANUAL_PAYMENT_METHODS.map((value) => (
            <option key={value} value={value}>
              {humanizeEnumValue(value)}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Payment date"
          id="paidAt"
          type="date"
          required
          value={paidAt}
          onChange={(event) => setPaidAt(event.target.value)}
        />
        <TextInput
          label="Reference / transaction number (optional)"
          id="referenceNumber"
          value={referenceNumber}
          onChange={(event) => setReferenceNumber(event.target.value)}
        />
        <div className="sm:col-span-2">
          <TextArea
            label="Note (optional)"
            id="paymentNotes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="sm:col-span-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="self-start sm:col-span-2">
          {submitting ? 'Recording…' : 'Record Payment'}
        </Button>
      </form>
    </Card>
  );
}
