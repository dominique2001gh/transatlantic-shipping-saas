import type { SaasPlanType } from '@transatlantic/shared';
import { apiFetch } from '@/lib/api';
import { getStoredToken } from '@/lib/auth';

export interface AdminSaasPlanPrice {
  id: string;
  interval: string;
  currency: string;
  setupFeeCents: number;
  monthlyAmountCents: number;
  trialDays: number;
  promoLabel: string | null;
  promoSetupFeeCents: number | null;
  promoMonthlyAmountCents: number | null;
  promoStartsAt: string | null;
  promoEndsAt: string | null;
  promoIsActive: boolean;
  promoMaxRedemptions: number | null;
  promoRedemptionCount: number;
  isFoundingOffer: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface AdminSaasPlan {
  id: string;
  key: SaasPlanType;
  name: string;
  description: string | null;
  isActive: boolean;
  prices: AdminSaasPlanPrice[];
}

export interface AddPlanPriceInput {
  currency?: string;
  setupFeeCents: number;
  monthlyAmountCents: number;
  trialDays?: number;
  promoLabel?: string;
  promoSetupFeeCents?: number;
  promoMonthlyAmountCents?: number;
  promoStartsAt?: string;
  promoEndsAt?: string;
  promoIsActive?: boolean;
  promoMaxRedemptions?: number;
  isFoundingOffer?: boolean;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  return apiFetch<T>(path, { ...options, token: token ?? undefined });
}

export function fetchAdminPlans(): Promise<AdminSaasPlan[]> {
  return authedFetch('/platform/plans');
}

export function createPlan(input: { key: SaasPlanType; name: string; description?: string }): Promise<AdminSaasPlan> {
  return authedFetch('/platform/plans', { method: 'POST', body: JSON.stringify(input) });
}

export function addPlanPrice(planId: string, input: AddPlanPriceInput): Promise<AdminSaasPlanPrice> {
  return authedFetch(`/platform/plans/${planId}/prices`, { method: 'POST', body: JSON.stringify(input) });
}
