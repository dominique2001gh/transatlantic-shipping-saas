import type {
  AffectedCustomerPreviewItem,
  DisruptionPreviewResponse,
  DisruptionType,
  NotificationSummary,
  OperationalExceptionSummary,
} from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export function listNotifications(filters?: { customerId?: string; channel?: string }): Promise<NotificationSummary[]> {
  const params = new URLSearchParams();
  if (filters?.customerId) params.set('customerId', filters.customerId);
  if (filters?.channel) params.set('channel', filters.channel);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiFetch<NotificationSummary[]>(`/notifications${qs}`, { token: authToken() });
}

export function listDisruptions(): Promise<OperationalExceptionSummary[]> {
  return apiFetch<OperationalExceptionSummary[]>('/disruptions', { token: authToken() });
}

export function previewDisruption(params: { containerId?: string; manifestId?: string }): Promise<AffectedCustomerPreviewItem[]> {
  const qs = params.containerId ? `containerId=${encodeURIComponent(params.containerId)}` : `manifestId=${encodeURIComponent(params.manifestId!)}`;
  return apiFetch<DisruptionPreviewResponse>(`/disruptions/preview?${qs}`, { token: authToken() }).then(
    (res) => res.affectedCustomers,
  );
}

export interface CreateDisruptionInput {
  containerId?: string;
  manifestId?: string;
  type: DisruptionType;
  message: string;
}

export function createDisruption(input: CreateDisruptionInput): Promise<OperationalExceptionSummary> {
  return apiFetch<OperationalExceptionSummary>('/disruptions', {
    method: 'POST',
    body: JSON.stringify(input),
    token: authToken(),
  });
}

export function resolveDisruption(id: string): Promise<OperationalExceptionSummary> {
  return apiFetch<OperationalExceptionSummary>(`/disruptions/${id}/resolve`, {
    method: 'PATCH',
    token: authToken(),
  });
}
