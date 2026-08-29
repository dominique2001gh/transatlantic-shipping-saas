'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ContainerDetail, ManifestDetail } from '@transatlantic/shared';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { ContainerContentsList } from '@/components/warehouse/ContainerContentsList';
import { ApiError } from '@/lib/api';
import { getContainer, listContainers } from '@/lib/containers';
import { assignContainerToManifest, unassignContainerFromManifest } from '@/lib/manifests';

/**
 * Ocean/RoRo assignment workspace: pick from LOADED (sealed), not-yet-
 * assigned containers, matching the same warehouse as the manifest's
 * origin when one is set. Mirrors LoadContainerWorkspace's picker
 * pattern, but assigning a whole container is a single action rather
 * than a scan-per-item loop.
 */
export function ManifestContainerAssignment({
  manifest,
  onUpdated,
  canModify,
}: {
  manifest: ManifestDetail;
  onUpdated: (manifest: ManifestDetail) => void;
  canModify: boolean;
}) {
  const [eligible, setEligible] = useState<ContainerDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<ContainerDetail | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const reloadEligible = useCallback(() => {
    listContainers({ status: 'LOADED' })
      .then((containers) =>
        setEligible(
          containers.filter(
            (c) => !c.manifestId && (!manifest.originWarehouse || c.warehouse?.id === manifest.originWarehouse.id),
          ),
        ),
      )
      .catch(() => setEligible([]));
  }, [manifest.originWarehouse]);

  useEffect(() => {
    reloadEligible();
  }, [reloadEligible]);

  async function handleAssign(containerId: string) {
    setAssigningId(containerId);
    setError(null);
    try {
      const updated = await assignContainerToManifest(manifest.id, containerId);
      onUpdated(updated);
      reloadEligible();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign container.');
    } finally {
      setAssigningId(null);
    }
  }

  async function handleUnassign(containerId: string) {
    setRemovingId(containerId);
    setError(null);
    try {
      const updated = await unassignContainerFromManifest(manifest.id, containerId);
      onUpdated(updated);
      reloadEligible();
      if (expandedId === containerId) {
        setExpandedId(null);
        setExpandedDetail(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove container.');
    } finally {
      setRemovingId(null);
    }
  }

  async function toggleExpand(containerId: string) {
    if (expandedId === containerId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(containerId);
    setExpandedDetail(null);
    setExpandedError(null);
    try {
      const detail = await getContainer(containerId);
      setExpandedDetail(detail);
    } catch (err) {
      setExpandedError(err instanceof ApiError ? err.message : 'Failed to load container contents.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {canModify && (
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Eligible containers</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Sealed (LOADED) containers not yet assigned to any manifest
            {manifest.originWarehouse ? ` at ${manifest.originWarehouse.name}` : ''}.
          </p>
          <ul className="mt-3 flex flex-col divide-y divide-slate-100">
            {eligible === null && <li className="py-3 text-sm text-slate-500">Loading…</li>}
            {eligible?.length === 0 && <li className="py-3 text-sm text-slate-500">No eligible containers right now.</li>}
            {eligible?.map((container) => (
              <li key={container.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>
                  <span className="font-mono font-medium text-slate-900">{container.containerNumber}</span>{' '}
                  <span className="text-slate-500">
                    — {container.containerType.replace(/_/g, ' ')} · {container.summary.itemCount} item
                    {container.summary.itemCount === 1 ? '' : 's'}
                    {container.warehouse ? ` · ${container.warehouse.code}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => handleAssign(container.id)}
                  disabled={assigningId === container.id}
                  className="shrink-0 rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-800 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {assigningId === container.id ? 'Assigning…' : 'Assign'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">
          Assigned containers ({manifest.containers.length})
        </h3>
        <ul className="mt-3 flex flex-col divide-y divide-slate-100">
          {manifest.containers.length === 0 && (
            <li className="py-3 text-sm text-slate-500">No containers assigned yet.</li>
          )}
          {manifest.containers.map((container) => (
            <li key={container.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => toggleExpand(container.id)}
                  className="flex flex-1 items-center gap-3 text-left text-sm font-medium text-primary-700 hover:text-primary-800"
                >
                  <span className="font-mono">{container.containerNumber}</span>
                  <span className="font-normal text-slate-500">{container.containerType.replace(/_/g, ' ')}</span>
                  <StatusBadge status={container.status} />
                </button>
                {canModify && (
                  <button
                    type="button"
                    onClick={() => handleUnassign(container.id)}
                    disabled={removingId === container.id}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {removingId === container.id ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </div>
              {expandedId === container.id && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  {expandedError && <p className="text-sm text-red-600">{expandedError}</p>}
                  {!expandedError && !expandedDetail && <p className="text-sm text-slate-500">Loading contents…</p>}
                  {expandedDetail && (
                    <ContainerContentsList container={expandedDetail} onRemove={() => undefined} removing={null} />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
