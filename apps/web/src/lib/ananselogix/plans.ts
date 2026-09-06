import type { SaasPlanSummary } from '@transatlantic/shared';
import { apiFetch } from '@/lib/api';

/** Public, unauthenticated — the pricing page and signup wizard's Step 1 both read from here. Never hardcode pricing in a component; see SaasPlansService's own doc comment. */
export function fetchPublicPlans(): Promise<SaasPlanSummary[]> {
  return apiFetch<SaasPlanSummary[]>('/public/plans');
}

export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

export const PLAN_DISPLAY_NAMES: Record<SaasPlanSummary['key'], string> = {
  WEBSITE_ONLY: 'Website Only',
  SOFTWARE_ONLY: 'Software Only',
  WEBSITE_AND_SOFTWARE: 'Website + Software',
  SOFTWARE_AND_WEBSITE_BASIC: 'Basic',
  SOFTWARE_AND_WEBSITE_PROFESSIONAL: 'Professional',
};
