import type { PortalNotificationSummary, UnreadNotificationCountResponse } from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * Stage 3H: typed client for the Customer Portal's notification API
 * (/portal/notifications*). Every response is already scoped server-side
 * to the caller's own tenant + Customer record, and already excludes
 * EMAIL/SMS/WHATSAPP delivery rows (IN_APP only) — this file does no
 * filtering of its own, exactly like lib/portal-documents.ts.
 */
export function getPortalNotifications(): Promise<PortalNotificationSummary[]> {
  return apiFetch<PortalNotificationSummary[]>('/portal/notifications', { token: authToken() });
}

export function getPortalUnreadCount(): Promise<number> {
  return apiFetch<UnreadNotificationCountResponse>('/portal/notifications/unread-count', { token: authToken() }).then(
    (res) => res.count,
  );
}

export function markPortalNotificationRead(id: string): Promise<PortalNotificationSummary> {
  return apiFetch<PortalNotificationSummary>(`/portal/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    token: authToken(),
  });
}
