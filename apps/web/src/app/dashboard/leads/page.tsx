'use client';

import { useEffect, useState } from 'react';
import type { WebsiteLeadSummary } from '@transatlantic/shared';
import { WebsiteLeadStatus, WebsiteLeadType } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Card } from '@/components/ui/Card';
import { formatDateTime, humanizeEnumValue } from '@/lib/format';
import { listLeads, updateLeadStatus } from '@/lib/leads';

/**
 * Website Launch: staff-facing view of leads captured by the public
 * Contact and Request-a-Quote forms (see apps/api/src/leads) — so a
 * submitted form is actually seen and actioned by a person, not just an
 * email that can get lost. Deliberately minimal: a list + a status
 * dropdown per row. Converting a lead into a real Customer/Quote is
 * always a manual action through the existing Customers/Quotes screens,
 * never automatic from here.
 */
export default function LeadsPage() {
  const [leads, setLeads] = useState<WebsiteLeadSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<WebsiteLeadStatus | ''>('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLeads(null);
    setError(false);
    listLeads(statusFilter ? { status: statusFilter } : undefined)
      .then(setLeads)
      .catch(() => setError(true));
  }, [statusFilter]);

  async function handleStatusChange(id: string, status: WebsiteLeadStatus) {
    setUpdatingId(id);
    try {
      const updated = await updateLeadStatus(id, { status });
      setLeads((prev) => prev?.map((l) => (l.id === updated.id ? updated : l)) ?? null);
    } catch {
      setError(true);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Website Leads</h1>
        <p className="mt-1 text-sm text-slate-500">Contact and Request-a-Quote submissions from the public website.</p>
      </div>

      <div className="mt-6 flex gap-2">
        {(['', WebsiteLeadStatus.NEW, WebsiteLeadStatus.CONTACTED, WebsiteLeadStatus.CLOSED] as const).map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              statusFilter === s ? 'bg-primary-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s ? humanizeEnumValue(s) : 'All'}
          </button>
        ))}
      </div>

      <Card className="mt-4 p-0">
        {error && (
          <p className="p-6 text-sm text-red-600">
            We couldn&apos;t load website leads right now. Please refresh the page, or try again shortly.
          </p>
        )}

        {!error && !leads && (
          <div className="divide-y divide-slate-100 px-4 sm:px-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse py-4">
                <div className="h-4 w-48 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        )}

        {!error && leads && leads.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-semibold text-slate-900">No leads yet</h2>
            <p className="max-w-sm px-6 text-sm text-slate-500">
              Submissions from the public website&apos;s Contact and Request-a-Quote forms will show up here.
            </p>
          </div>
        )}

        {!error && leads && leads.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {leads.map((lead) => {
              const isExpanded = expandedId === lead.id;
              return (
                <li key={lead.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 text-left hover:bg-slate-50 sm:px-6"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {lead.firstName} {lead.lastName ?? ''}
                        <span className="ml-2 font-normal text-slate-400">{lead.email}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {lead.type === WebsiteLeadType.QUOTE_REQUEST ? 'Quote request' : 'Contact message'}
                        {lead.subject ? ` · ${lead.subject}` : ''} · {formatDateTime(lead.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={lead.status} />
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50 px-4 py-4 sm:px-6">
                      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                        {lead.phone && (
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Phone</dt>
                            <dd className="mt-0.5 text-slate-700">{lead.phone}</dd>
                          </div>
                        )}
                        {lead.message && (
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Message</dt>
                            <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">{lead.message}</dd>
                          </div>
                        )}
                        {lead.quoteDetails && (
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Shipment details</dt>
                            <dd className="mt-1 grid grid-cols-2 gap-2 text-slate-700 sm:grid-cols-3">
                              {Object.entries(lead.quoteDetails)
                                .filter(([, v]) => v)
                                .map(([key, value]) => (
                                  <span key={key}>
                                    <span className="text-slate-400">{humanizeEnumValue(key)}:</span> {String(value)}
                                  </span>
                                ))}
                            </dd>
                          </div>
                        )}
                      </dl>

                      <div className="mt-4 flex items-center gap-2">
                        <label htmlFor={`status-${lead.id}`} className="text-xs font-medium text-slate-500">
                          Status:
                        </label>
                        <select
                          id={`status-${lead.id}`}
                          value={lead.status}
                          disabled={updatingId === lead.id}
                          onChange={(e) => handleStatusChange(lead.id, e.target.value as WebsiteLeadStatus)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                          <option value={WebsiteLeadStatus.NEW}>New</option>
                          <option value={WebsiteLeadStatus.CONTACTED}>Contacted</option>
                          <option value={WebsiteLeadStatus.CLOSED}>Closed</option>
                        </select>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
