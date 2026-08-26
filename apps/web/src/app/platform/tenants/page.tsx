'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { apiFetch, ApiError } from '@/lib/api';
import { getStoredToken } from '@/lib/auth';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  isActive: boolean;
}

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    apiFetch<Tenant[]>('/tenants', { token })
      .then(setTenants)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load tenants'));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Tenants</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every freight forwarding company running on this platform.
      </p>

      <Card className="mt-6 overflow-x-auto p-0">
        {error && <p className="p-6 text-sm text-red-600">{error}</p>}
        {!error && !tenants && <p className="p-6 text-sm text-slate-500">Loading…</p>}
        {!error && tenants && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Slug</th>
                <th className="px-6 py-3 font-medium">Country</th>
                <th className="px-6 py-3 font-medium">Currency</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td className="px-6 py-3 font-medium text-slate-900">{tenant.name}</td>
                  <td className="px-6 py-3 text-slate-500">{tenant.slug}</td>
                  <td className="px-6 py-3 text-slate-500">{tenant.country}</td>
                  <td className="px-6 py-3 text-slate-500">{tenant.currency}</td>
                  <td className="px-6 py-3">
                    <Badge variant={tenant.isActive ? 'success' : 'neutral'}>
                      {tenant.isActive ? 'Active' : 'Inactive'}
                    </Badge>
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
