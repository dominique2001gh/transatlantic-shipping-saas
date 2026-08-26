'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { apiFetch } from '@/lib/api';
import { getStoredToken } from '@/lib/auth';

interface TenantSummary {
  id: string;
  isActive: boolean;
}

export default function PlatformOverviewPage() {
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    apiFetch<TenantSummary[]>('/tenants', { token })
      .then(setTenants)
      .catch(() => setTenants(null));
  }, []);

  const activeCount = tenants?.filter((t) => t.isActive).length ?? null;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Platform Overview</h1>
      <p className="mt-1 text-sm text-slate-500">Every tenant on the platform, at a glance.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">Total Tenants</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {tenants?.length ?? '—'}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Active Tenants</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{activeCount ?? '—'}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Platform Users</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">—</p>
        </Card>
      </div>
    </div>
  );
}
