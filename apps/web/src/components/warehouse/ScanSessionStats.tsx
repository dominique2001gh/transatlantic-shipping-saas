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
  lastScannedCode,
  weightByUnit,
}: {
  succeeded: number;
  succeededLabel?: string;
  duplicates: number;
  errors: number;
  /** Simplified Operational Scanning Workflow (Phase 2): optional — code of the most recently successful scan, so staff always have a persistent "what did I just scan" readout, not just a transient banner. */
  lastScannedCode?: string | null;
  /** Simplified Operational Scanning Workflow (Phase 2): optional — already computed by the caller (e.g. Container.summary.weightByUnit), rendered as-is with no unit conversion. Usually one entry; rendered per-unit in the rare mixed-unit case. */
  weightByUnit?: Record<string, number> | null;
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
      {lastScannedCode && (
        <span>
          Last scanned: <strong className="font-mono text-slate-900">{lastScannedCode}</strong>
        </span>
      )}
      {weightByUnit &&
        Object.entries(weightByUnit).map(([unit, value]) => (
          <span key={unit}>
            Total weight: <strong className="text-slate-900">{value.toFixed(2)}</strong> {unit}
          </span>
        ))}
    </div>
  );
}
