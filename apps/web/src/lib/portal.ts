import type { PortalCustomerProfile, PortalShipmentDetail, PortalShipmentSummary } from '@transatlantic/shared';
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
