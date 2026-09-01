'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { PaymentListItem } from '@transatlantic/shared';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime, humanizeEnumValue, statusBadgeVariant } from '@/lib/format';
import { listPayments } from '@/lib/payments';

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    listPayments()
      .then(setPayments)
      .catch((err) => {
        if (err instanceof ApiError && err.statusCode === 403) {
          setError("You don't have permission to view payments.");
        } else {
          setError(err instanceof ApiError ? err.message : 'Failed to load payments.');
        }
      });
  }, []);

  const filtered = useMemo(() => {
    if (!payments) return [];
    const term = search.trim().toLowerCase();
    if (!term) return payments;
    return payments.filter(
      (payment) =>
        payment.invoiceNumber.toLowerCase().includes(term) || payment.customerName.toLowerCase().includes(term),
    );
  }, [payments, search]);

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Payments</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every payment recorded against a customer invoice. To record a new one, open the invoice and use Record
          Payment.
        </p>
      </div>

      <div className="mt-6">
        <input
          type="text"
          placeholder="Search by invoice # or customer…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      <Card className="mt-4 overflow-x-auto p-0">
        {error && <p className="p-6 text-sm text-red-600">{error}</p>}
        {!error && !payments && <p className="p-6 text-sm text-slate-500">Loading…</p>}
        {!error && payments && filtered.length === 0 && (
          <p className="p-6 text-sm text-slate-500">
            {payments.length === 0 ? 'No payments recorded yet.' : 'No payments match your search.'}
          </p>
        )}
        {!error && payments && filtered.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((payment) => (
                <tr key={payment.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">
                    {payment.paidAt ? formatDateTime(payment.paidAt) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">
                    <Link href={`/dashboard/invoices/${payment.invoiceId}`} className="hover:text-primary-700">
                      {payment.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{payment.customerName}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {formatCurrency(payment.amount, payment.currency)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{humanizeEnumValue(payment.method)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusBadgeVariant(payment.status)}>{humanizeEnumValue(payment.status)}</Badge>
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
