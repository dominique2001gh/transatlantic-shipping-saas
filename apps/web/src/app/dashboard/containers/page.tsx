'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ContainerDetail } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { ContainerContentsList } from '@/components/warehouse/ContainerContentsList';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { finalizeContainer, listContainers, unloadItemFromContainer } from '@/lib/containers';
import { formatDateTime } from '@/lib/format';

const FINALIZE_ROLES = new Set<UserRole>([UserRole.TENANT_OWNER, UserRole.TENANT_ADMIN, UserRole.WAREHOUSE_MANAGER]);

const STATUS_FILTERS = ['ALL', 'BOOKED', 'LOADING', 'LOADED', 'DEPARTED', 'IN_TRANSIT', 'ARRIVED', 'CLOSED'] as const;

export default function ContainersPage() {
  const [containers, setContainers] = useState<ContainerDetail[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);

  const currentUser = getStoredUser();
  const canFinalize = !!currentUser && FINALIZE_ROLES.has(currentUser.role);

  const reload = useCallback(() => {
    listContainers(statusFilter === 'ALL' ? undefined : { status: statusFilter })
      .then(setContainers)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load containers.'));
  }, [statusFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  const selected = containers?.find((c) => c.id === selectedId) ?? null;

  async function handleFinalize() {
    if (!selected) return;
    if (!window.confirm(`Finalize and seal container ${selected.containerNumber}? This cannot be undone.`)) return;
    setFinalizing(true);
    try {
      await finalizeContainer(selected.id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to finalize container.');
    } finally {
      setFinalizing(false);
    }
  }

  async function handleRemove(itemId: string) {
    if (!selected) return;
    setRemovingItemId(itemId);
    try {
      await unloadItemFromContainer(selected.id, itemId);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove item.');
    } finally {
      setRemovingItemId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Containers</h1>
        <p className="mt-1 text-sm text-slate-500">
          Book containers and consolidate shipments from multiple customers. Load items from Warehouse → Load
          Container.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === status
                ? 'bg-primary-700 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {status === 'ALL' ? 'All' : status.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Container #</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Warehouse</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Customers</th>
                <th className="px-4 py-3 font-medium">Sealed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {containers === null && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {containers?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                    No containers yet.
                  </td>
                </tr>
              )}
              {containers?.map((container) => (
                <tr
                  key={container.id}
                  onClick={() => setSelectedId(container.id)}
                  className={`cursor-pointer hover:bg-slate-50 ${selectedId === container.id ? 'bg-primary-50/60' : ''}`}
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">{container.containerNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{container.containerType.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-slate-500">{container.warehouse?.code ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={container.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{container.summary.itemCount}</td>
                  <td className="px-4 py-3 text-slate-600">{container.summary.customerCount}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {container.loadingFinalizedAt ? formatDateTime(container.loadingFinalizedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-900">{selected.containerNumber}</p>
              <p className="text-sm text-slate-600">
                {selected.containerType.replace(/_/g, ' ')}
                {selected.sealNumber ? ` · Seal ${selected.sealNumber}` : ''}
                {selected.route ? ` · Route: ${selected.route.name}` : ''}
              </p>
            </div>
            <StatusBadge status={selected.status} />
          </div>

          <div className="mt-4">
            <ContainerContentsList container={selected} onRemove={handleRemove} removing={removingItemId} />
          </div>

          {selected.status === 'LOADING' && canFinalize && (
            <div className="mt-5">
              <Button type="button" onClick={handleFinalize} disabled={finalizing}>
                {finalizing ? 'Finalizing…' : 'Finalize / Seal Container'}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
