import type { PortalPreRegistration, PreRegistrationFormFields, StaffPreRegistrationLookup } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * Customer Self-Service Pre-Registration, Stage 2: typed client for the
 * Stage 1 customer-facing API (/portal/pre-registrations). Every response
 * here is already scoped server-side to the caller's own tenant + linked
 * Customer record (see PreRegistrationsController/PreRegistrationsService
 * — @Roles(CUSTOMER), tenantId + customerId both read from the verified
 * JWT). This file does no filtering of its own and must never be treated
 * as a security boundary — same posture as lib/portal.ts.
 */
export function createPreRegistration(payload: PreRegistrationFormFields): Promise<PortalPreRegistration> {
  return apiFetch<PortalPreRegistration>('/portal/pre-registrations', {
    method: 'POST',
    body: JSON.stringify(payload),
    token: authToken(),
  });
}

export function listPreRegistrations(): Promise<PortalPreRegistration[]> {
  return apiFetch<PortalPreRegistration[]>('/portal/pre-registrations', { token: authToken() });
}

export function getPreRegistration(id: string): Promise<PortalPreRegistration> {
  return apiFetch<PortalPreRegistration>(`/portal/pre-registrations/${encodeURIComponent(id)}`, { token: authToken() });
}

/** Only succeeds while the record is still DRAFT — see PreRegistrationsService.update's own doc comment. */
export function updatePreRegistration(id: string, payload: PreRegistrationFormFields): Promise<PortalPreRegistration> {
  return apiFetch<PortalPreRegistration>(`/portal/pre-registrations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    token: authToken(),
  });
}

/** DRAFT -> SUBMITTED. Assigns the PRE-<year>-###### reference — see ShipmentPreRegistration's own schema doc comment. */
export function submitPreRegistration(id: string): Promise<PortalPreRegistration> {
  return apiFetch<PortalPreRegistration>(`/portal/pre-registrations/${encodeURIComponent(id)}/submit`, {
    method: 'POST',
    token: authToken(),
  });
}

/** DRAFT or SUBMITTED -> CANCELLED. Rejects (409) once CONVERTED. */
export function cancelPreRegistration(id: string): Promise<PortalPreRegistration> {
  return apiFetch<PortalPreRegistration>(`/portal/pre-registrations/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    token: authToken(),
  });
}

/**
 * Customer Self-Service Pre-Registration, Stage 3: staff-facing exact-match
 * lookup by PRE-* reference (typed or scanned), used by Quick Receive's
 * "Prepared Drop-Off?" section. Tenant-scoped only, not customer-scoped —
 * see PreRegistrationsStaffController/PreRegistrationsService.
 * findByReferenceForStaff. Throws (via apiFetch/ApiError) with a 404 for
 * an unknown or another tenant's reference — both indistinguishable, by
 * design.
 */
export function scanPreRegistrationForStaff(code: string): Promise<StaffPreRegistrationLookup> {
  const params = new URLSearchParams({ code });
  return apiFetch<StaffPreRegistrationLookup>(`/pre-registrations/scan?${params.toString()}`, {
    token: authToken(),
  });
}
