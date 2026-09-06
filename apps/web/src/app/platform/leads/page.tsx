'use client';

import { useEffect, useState } from 'react';
import type { PlatformLeadSummary } from '@transatlantic/shared';
import { PlatformLeadStatus } from '@transatlantic/shared';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SelectInput } from '@/components/forms/FormField';
import { ApiError } from '@/lib/api';
import { fetchPlatformLeads, updatePlatformLeadStatus } from '@/lib/platform';

const STATUS_OPTIONS: PlatformLeadStatus[] = Object.values(PlatformLeadStatus);
const STATUS_BADGE: Record<PlatformLeadStatus, 'primary' | 'accent' | 'success' | 'warning' | 'neutral'> = {
  [PlatformLeadStatus.NEW]: 'primary',
  [PlatformLeadStatus.CONTACTED]: 'accent',
  [PlatformLeadStatus.DEMO_SCHEDULED]: 'accent',
  [PlatformLeadStatus.TRIAL]: 'warning',
  [PlatformLeadStatus.CONVERTED]: 'success',
  [PlatformLeadStatus.LOST]: 'neutral',
};

export default function PlatformLeadsPage() {
  const [leads, setLeads] = useState<PlatformLeadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetchPlatformLeads()
      .then(setLeads)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load leads'));
  }

  useEffect(load, []);

  async function handleStatusChange(id: string, status: PlatformLeadStatus) {
    try {
      await updatePlatformLeadStatus(id, status);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update lead');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Leads</h1>
      <p className="mt-1 text-sm text-slate-500">Prospects who requested a demo via the AnanseLogix marketing site.</p>

      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      {!error && !leads && <p className="mt-4 text-sm text-slate-500">Loading…</p>}

      <div className="mt-6 flex flex-col gap-4">
        {leads?.length === 0 && <p className="text-sm text-slate-500">No leads yet.</p>}
        {leads?.map((lead) => (
          <Card key={lead.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">{lead.companyName}</h3>
                <p className="text-sm text-slate-500">
                  {lead.contactName} · {lead.email} {lead.phone ? `· ${lead.phone}` : ''}
                </p>
                {lead.country && <p className="text-xs text-slate-400">{lead.country}</p>}
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={STATUS_BADGE[lead.status]}>{lead.status.replaceAll('_', ' ')}</Badge>
                <div className="w-44">
                  <SelectInput
                    label={`Status for ${lead.companyName}`}
                    hideLabel
                    id={`status-${lead.id}`}
                    value={lead.status}
                    onChange={(e) => handleStatusChange(lead.id, e.target.value as PlatformLeadStatus)}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </SelectInput>
                </div>
              </div>
            </div>
            {lead.servicesOffered.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">Services: {lead.servicesOffered.join(', ')}</p>
            )}
            {lead.message && <p className="mt-2 text-sm text-slate-600">{lead.message}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
