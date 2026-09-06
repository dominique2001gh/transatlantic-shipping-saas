import type {
  TenantInvitationSummary,
  TenantOnboardingSummary,
  TenantSubscriptionSummary,
  UserRole,
} from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

export interface OnboardingOverview {
  tenant: {
    name: string;
    logoUrl: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    phone: string | null;
    email: string;
    whatsappNumber: string | null;
  };
  onboarding: TenantOnboardingSummary;
  warehouses: { id: string; name: string; code: string; isOriginWarehouse: boolean; isDestinationWarehouse: boolean }[];
  invitations: TenantInvitationSummary[];
  subscription: TenantSubscriptionSummary | null;
}

function authedFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  return apiFetch<T>(path, { ...options, token: token ?? undefined });
}

export function getOnboardingOverview(): Promise<OnboardingOverview> {
  return authedFetch<OnboardingOverview>('/onboarding');
}

export function updateBranding(input: {
  displayName?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  publicPhone?: string;
  publicEmail?: string;
  whatsappNumber?: string;
}): Promise<TenantOnboardingSummary> {
  return authedFetch('/onboarding/branding', { method: 'POST', body: JSON.stringify(input) });
}

export function updateOperations(input: {
  defaultOriginCountry?: string;
  defaultDestinationCountry?: string;
  warehouses?: { name: string; code: string; addressLine1: string; city: string; country: string; isOriginWarehouse?: boolean; isDestinationWarehouse?: boolean }[];
}): Promise<TenantOnboardingSummary> {
  return authedFetch('/onboarding/operations', { method: 'POST', body: JSON.stringify(input) });
}

export function inviteStaff(input: { email: string; role: UserRole }): Promise<TenantInvitationSummary> {
  return authedFetch('/onboarding/staff/invite', { method: 'POST', body: JSON.stringify(input) });
}

export function completeStaffStep(): Promise<TenantOnboardingSummary> {
  return authedFetch('/onboarding/staff/complete', { method: 'POST' });
}

export function updateTracking(input: { trackingNumberPrefix?: string }): Promise<TenantOnboardingSummary> {
  return authedFetch('/onboarding/tracking', { method: 'POST', body: JSON.stringify(input) });
}

export function updateNotifications(input: { emailEnabled?: boolean; inAppEnabled?: boolean }): Promise<TenantOnboardingSummary> {
  return authedFetch('/onboarding/notifications', { method: 'POST', body: JSON.stringify(input) });
}

export function createBillingPortalSession(returnUrl: string): Promise<{ url: string }> {
  return authedFetch('/onboarding/billing/portal-session', { method: 'POST', body: JSON.stringify({ returnUrl }) });
}

export function finishOnboarding(): Promise<TenantOnboardingSummary> {
  return authedFetch('/onboarding/finish', { method: 'POST' });
}
