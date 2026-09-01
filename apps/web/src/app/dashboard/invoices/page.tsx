'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { InvoiceSummary } from '@transatlantic/shared';
import { InvoiceStatus } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { listInvoices } from '@/lib/invoices';

const STATUS_FILTERS: { label: string; value: InvoiceStatus | '' }[] = [
  { label: 'All statuses', value: '' },
  { label: 'Draft', value: InvoiceStatus.DRAFT },
  { label: 'Sent', value: InvoiceStatus.SENT },
  { label: 'Partially Paid', value: InvoiceStatus.PARTIALLY_PAID },
  { label: 'Paid', value: InvoiceStatus.PAID },
  { label: 'Overdue', value: InvoiceStatus.OVERDUE },
  { label: 'Void', value: InvoiceStatus.VOID },
];

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    listInvoices(statusFilter ? { status: statusFilter } : undefined)
      .then(setInvoices)
      .catch((err) => {
        if (err instanceof ApiError && err.statusCode === 403) {
          setError("You don't have permission to view invoices.");
        } else {
          setError(err instanceof ApiError ? err.message : 'Failed to load invoices.');
        }
      });
  }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!invoices) return [];
    const term = search.trim().toLowerCase();
    if (!term) return invoices;
    return invoices.filter(
      (invoice) =>
        invoice.invoiceNumber.toLowerCase().includes(term) ||
        invoice.customerName.toLowerCase().includes(term) ||
        (invoice.shipmentTrackingNumber ?? '').toLowerCase().includes(term),
    );
  }, [invoices, search]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
          <p className="mt-1 text-sm text-slate-500">Create and manage invoices for customer shipments.</p>
        </div>
        <Link href="/dashboard/invoices/new">
          <Button>New Invoice</Button>
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by invoice #, customer, or tracking #…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as InvoiceStatus | '')}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <Card className="mt-4 overflow-x-auto p-0">
        {error && <p className="p-6 text-sm text-red-600">{error}</p>}
        {!error && !invoices && <p className="p-6 text-sm text-slate-500">Loading…</p>}
        {!error && invoices && filtered.length === 0 && (
          <p className="p-6 text-sm text-slate-500">
            {invoices.length === 0 ? 'No invoices yet.' : 'No invoices match your search.'}
          </p>
        )}
        {!error && invoices && filtered.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Shipment</th>
                <th className="px-4 py-3 font-medium">Invoice Date</th>
                <th className="px-4 py-3 font-medium">Due Date</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Paid</th>
                <th className="px-4 py-3 font-medium">Balance</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">
                    <Link href={`/dashboard/invoices/${invoice.id}`} className="hover:text-primary-700">
                      {invoice.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{invoice.customerName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {invoice.shipmentTrackingNumber ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(invoice.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-500">{invoice.dueDate ? formatDate(invoice.dueDate) : '—'}</td>
                  <td className="px-4 py-3 text-slate-900">{formatCurrency(invoice.total, invoice.currency)}</td>
                  <td className="px-4 py-3 text-slate-500">{formatCurrency(invoice.amountPaid, invoice.currency)}</td>
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
        )}
      </Card>
    </div>
  );
}
