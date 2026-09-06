/**
 * Phase 3 (hardware acceptance): a running per-session tally for
 * continuous-scan modes — "maintain appropriate counts" without an
 * operator ever having to check the inventory table mid-run. Counts live
 * in whichever workspace component renders this (Receive/Load/Destination
 * Receive each reset them on their own terms — e.g. Load resets per
 * container, Receive resets per page load) — this component is purely
 * presentational.
 */
export function ScanSessionStats({
  succeeded,
  succeededLabel = 'scanned this session',
  duplicates,
  errors,
}: {
  succeeded: number;
  succeededLabel?: string;
  duplicates: number;
  errors: number;
}) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
      <span>
        <strong className="text-emerald-700">{succeeded}</strong> {succeededLabel}
      </span>
      <span>
        <strong className={duplicates > 0 ? 'text-amber-700' : 'text-slate-900'}>{duplicates}</strong> duplicate
        {duplicates === 1 ? '' : 's'} rejected
      </span>
      <span>
        <strong className={errors > 0 ? 'text-red-700' : 'text-slate-900'}>{errors}</strong> error{errors === 1 ? '' : 's'}
      </span>
    </div>
  );
}
