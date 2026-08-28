'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CustomerSummary } from '@transatlantic/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { listCustomers } from '@/lib/customers';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listCustomers(search || undefined)
      .then((data) => {
        if (active) setCustomers(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Failed to load customers.');
      });
    return () => {
      active = false;
    };
  }, [search]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Manage customer profiles and view their shipments.</p>
        </div>
        <Link href="/dashboard/customers/new">
          <Button>New Customer</Button>
        </Link>
      </div>

      <div className="mt-6">
        <input
          type="search"
          placeholder="Search by name, email, or customer number…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-80"
        />
      </div>

      <Card className="mt-6 overflow-x-auto p-0">
        {error && <p className="p-6 text-sm text-red-600">{error}</p>}
        {!error && !customers && <p className="p-6 text-sm text-slate-500">Loading…</p>}
        {!error && customers && customers.length === 0 && (
          <p className="p-6 text-sm text-slate-500">No customers yet.</p>
        )}
        {!error && customers && customers.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Customer #</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((customer) => (
                <tr key={customer.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link href={`/dashboard/customers/${customer.id}`} className="hover:text-primary-700">
                      {customer.customerNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {customer.firstName} {customer.lastName}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{customer.email}</td>
                  <td className="px-4 py-3 text-slate-500">{customer.phone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
