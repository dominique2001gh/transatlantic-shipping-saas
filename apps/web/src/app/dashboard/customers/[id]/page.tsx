'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CustomerDetail } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getCustomer } from '@/lib/customers';
import { humanizeEnumValue } from '@/lib/format';

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCustomer(params.id)
      .then(setCustomer)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load customer.'));
  }, [params.id]);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!customer) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Customer {customer.customerNumber}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          {customer.firstName} {customer.lastName}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {customer.email}
          {customer.phone ? ` · ${customer.phone}` : ''}
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Shipments</h2>
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Tracking #</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customer.shipments.map((shipment) => (
                <tr key={shipment.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">
                    <Link href={`/dashboard/shipments/${shipment.id}`} className="hover:text-primary-700">
                      {shipment.trackingNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{humanizeEnumValue(shipment.shipmentMode)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {shipment.itemCounts?.received ?? 0} / {shipment.itemCounts?.total ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={shipment.status} />
                  </td>
                </tr>
              ))}
              {customer.shipments.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                    No shipments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>

      {customer.addresses.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Addresses</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {customer.addresses.map((address) => (
              <Card key={address.id}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-900">
                    {address.label ?? humanizeEnumValue(address.type)}
                  </p>
                  {address.isDefault && <Badge variant="primary">Default</Badge>}
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}
                  <br />
                  {address.city}
                  {address.state ? `, ${address.state}` : ''} {address.postalCode ?? ''}
                  <br />
                  {address.country}
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
