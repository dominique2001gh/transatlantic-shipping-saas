'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ManifestPrintDocument as ManifestPrintDocumentData } from '@transatlantic/shared';
import { ManifestPrintDocument } from '@/components/manifests/ManifestPrintDocument';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { downloadManifestPdf, getManifestPrintDocument } from '@/lib/manifests';

/**
 * Dedicated printable page for one manifest — same shape as
 * /dashboard/shipments/[id]/labels: still rendered inside DashboardLayout
 * (AppShell's sidebar/topbar are already `print:hidden`, see
 * globals.css), so this page only needs to hide its own toolbar with
 * `print:hidden`. GET /manifests/:id/print is VIEW_ROLES-gated and
 * tenant-scoped exactly like every other manifest endpoint — a user can
 * no more reach another tenant's manifest here by editing the URL than
 * anywhere else in the app; a cross-tenant id 404s the same as
 * /dashboard/manifests itself would.
 */
export default function ManifestPrintPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<ManifestPrintDocumentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    getManifestPrintDocument(params.id)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load manifest.'));
  }, [params.id]);

  async function handleDownload() {
    if (!data) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadManifestPdf(data.manifest.id, data.manifest.manifestNumber);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to download PDF.');
    } finally {
      setDownloading(false);
    }
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Manifest {data.manifest.manifestNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">Printable manifest and cargo/packing list.</p>
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Preparing PDF…' : 'Download PDF'}
          </Button>
          <Button type="button" onClick={() => window.print()}>
            Print Manifest
          </Button>
        </div>
      </div>

      <ManifestPrintDocument data={data} />
    </div>
  );
}
