import type { ReactNode } from 'react';

/**
 * A "fake browser window" frame for product UI mockups — real AnanseLogix
 * product visuals built from this app's own design tokens (Tailwind
 * primary/accent colors, the same rounded-2xl/shadow-xl language Card
 * already uses), not stock photography or an external screenshot asset.
 * Deliberately shows demo data only (see each caller's own doc comment) —
 * never a real tenant's shipments, customers, or financial figures.
 */
export function BrowserFrame({ children, url = 'app.ananselogix.com/dashboard', className = '' }: { children: ReactNode; url?: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        <span className="ml-3 truncate rounded-md border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-400">{url}</span>
      </div>
      <div className="bg-slate-50 p-4 sm:p-5">{children}</div>
    </div>
  );
}

export function StatTile({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'accent' | 'primary' }) {
  const toneClasses = {
    slate: 'text-slate-900',
    accent: 'text-accent-600',
    primary: 'text-primary-700',
  } as const;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 font-display text-xl font-bold ${toneClasses[tone]}`}>{value}</p>
    </div>
  );
}

/** A row of simple CSS bars — enough to read as "a chart" without a charting library or external asset. */
export function MiniBarChart({ bars, label }: { bars: number[]; label: string }) {
  const max = Math.max(...bars, 1);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-3 flex h-16 items-end gap-1.5">
        {bars.map((v, i) => (
          <div key={i} className="flex-1 rounded-t bg-primary-600/80" style={{ height: `${Math.max((v / max) * 100, 8)}%` }} />
        ))}
      </div>
    </div>
  );
}

export interface MockRow {
  primary: string;
  secondary: string;
  badge: { text: string; tone: 'emerald' | 'amber' | 'slate' | 'red' };
}

const BADGE_TONE = {
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  slate: 'bg-slate-100 text-slate-600',
  red: 'bg-red-50 text-red-700',
} as const;

export function MockList({ label, rows }: { label: string; rows: MockRow[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <ul className="mt-2 flex flex-col divide-y divide-slate-100">
        {rows.map((row) => (
          <li key={row.primary} className="flex items-center justify-between gap-3 py-2 text-sm first:pt-1 last:pb-0">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-800">{row.primary}</p>
              <p className="truncate text-xs text-slate-400">{row.secondary}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_TONE[row.badge.tone]}`}>{row.badge.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
