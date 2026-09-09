/**
 * Shared date-range preset logic — extracted from dashboard/reports so the
 * Executive Dashboard (/dashboard) can reuse the exact same preset
 * semantics/date math instead of a second implementation. Reports keeps
 * its full preset list (see PRESET_LABELS); the Executive Dashboard uses
 * only EXECUTIVE_PRESET_KEYS, a small subset, but both read the same
 * computeRange() so "Last 7 days" can never mean two different things on
 * the two pages.
 */

export type PresetKey = 'today' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'custom';

export const PRESET_LABELS: Record<PresetKey, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  thisMonth: 'This Month',
  lastMonth: 'Last Month',
  thisQuarter: 'This Quarter',
  thisYear: 'This Year',
  custom: 'Custom range',
};

/** The compact preset set offered by the Executive Dashboard's small date-range selector — a subset of Reports' full list, same underlying computeRange(). */
export const EXECUTIVE_PRESET_KEYS: PresetKey[] = ['today', '7d', '30d'];

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeRange(preset: PresetKey): { from: string; to: string } {
  const now = new Date();
  const end = isoDate(now);
  switch (preset) {
    case 'today':
      return { from: end, to: end };
    case '7d':
      return { from: isoDate(new Date(now.getTime() - 7 * 86400000)), to: end };
    case 'thisMonth':
      return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: end };
    case 'lastMonth': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: isoDate(first), to: isoDate(last) };
    }
    case 'thisQuarter': {
      const q = Math.floor(now.getMonth() / 3);
      return { from: isoDate(new Date(now.getFullYear(), q * 3, 1)), to: end };
    }
    case 'thisYear':
      return { from: isoDate(new Date(now.getFullYear(), 0, 1)), to: end };
    case '30d':
    default:
      return { from: isoDate(new Date(now.getTime() - 30 * 86400000)), to: end };
  }
}
