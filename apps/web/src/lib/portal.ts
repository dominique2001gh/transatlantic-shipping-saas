import type {
  PortalCustomerProfile,
  PortalNotificationPreferences,
  PortalShipmentDetail,
  PortalShipmentSummary,
  UpdatePortalNotificationPreferencesRequest,
  UpdatePortalProfileRequest,
} from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * Typed client for the Stage 2C authenticated Customer Portal API
 * (/portal/*). Every response here is already scoped server-side to the
 * caller's own tenant + linked Customer record (see
 * CustomerPortalService/TrackingService — @Roles(CUSTOMER), tenantId +
 * customerId both read from the verified JWT). This file does no
 * filtering of its own and must never be treated as a security boundary —
 * it only shapes HTTP calls, exactly like lib/shipments.ts and
 * lib/tracking.ts already do for their own resources.
 */
export function getPortalProfile(): Promise<PortalCustomerProfile> {
  return apiFetch<PortalCustomerProfile>('/portal/me', { token: authToken() });
}

export function listPortalShipments(): Promise<PortalShipmentSummary[]> {
  return apiFetch<PortalShipmentSummary[]>('/portal/shipments', { token: authToken() });
}

export function getPortalShipmentDetail(id: string): Promise<PortalShipmentDetail> {
  return apiFetch<PortalShipmentDetail>(`/portal/shipments/${encodeURIComponent(id)}`, { token: authToken() });
}

/**
 * Stage 3I: partial update of the caller's own profile — firstName/
 * lastName/phone only. See UpdatePortalProfileRequest's own doc comment
 * for why email/customerNumber aren't here.
 */
export function updatePortalProfile(payload: UpdatePortalProfileRequest): Promise<PortalCustomerProfile> {
  return apiFetch<PortalCustomerProfile>('/portal/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
    token: authToken(),
  });
}

export function getPortalNotificationPreferences(): Promise<PortalNotificationPreferences> {
  return apiFetch<PortalNotificationPreferences>('/portal/me/notification-preferences', { token: authToken() });
}

/**
 * Stage 3I: partial update of channel preferences. The API validates the
 * resulting merged state server-side (e.g. WhatsApp can't be enabled with
 * no number on file) — this function does no validation of its own.
 */
export function updatePortalNotificationPreferences(
  payload: UpdatePortalNotificationPreferencesRequest,
): Promise<PortalNotificationPreferences> {
  return apiFetch<PortalNotificationPreferences>('/portal/me/notification-preferences', {
    method: 'PATCH',
    body: JSON.stringify(payload),
    token: authToken(),
  });
}
