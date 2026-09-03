import type {
  AnalyticsAlertsResponse,
  AnalyticsCustomersResponse,
  AnalyticsDateRangeQuery,
  AnalyticsDestinationsResponse,
  AnalyticsExceptionsResponse,
  AnalyticsOperationsResponse,
  AnalyticsOverviewResponse,
  AnalyticsRevenueResponse,
} from '@transatlantic/shared';
import { apiFetch } from './api';
import { getStoredToken } from './auth';

function authToken(): string {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * Stage 4: typed client for the Owner/Manager Analytics API
 * (/analytics/*). Every response here is already scoped server-side to
 * the caller's own tenant (see AnalyticsService — tenantId is read from
 * the verified JWT, never a query param) and, for every route except
 * getAnalyticsOverview, role-gated to ANALYTICS_ROLES. This file does no
 * filtering of its own and must never be treated as a security boundary
 * — it only shapes HTTP calls, exactly like lib/portal.ts does for its
 * own resources.
 */
function toQueryString(query?: AnalyticsDateRangeQuery): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.shipmentMode) params.set('shipmentMode', query.shipmentMode);
  if (query.warehouseId) params.set('warehouseId', query.warehouseId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Backs the general Dashboard Overview tiles — open to any DASHBOARD_ROLES member, no financial data. */
export function getAnalyticsOverview(): Promise<AnalyticsOverviewResponse> {
  return apiFetch<AnalyticsOverviewResponse>('/analytics/overview', { token: authToken() });
}

export function getAnalyticsAlerts(): Promise<AnalyticsAlertsResponse> {
  return apiFetch<AnalyticsAlertsResponse>('/analytics/alerts', { token: authToken() });
}

export function getAnalyticsRevenue(query?: AnalyticsDateRangeQuery): Promise<AnalyticsRevenueResponse> {
  return apiFetch<AnalyticsRevenueResponse>(`/analytics/revenue${toQueryString(query)}`, { token: authToken() });
}

export function getAnalyticsOperations(query?: AnalyticsDateRangeQuery): Promise<AnalyticsOperationsResponse> {
  return apiFetch<AnalyticsOperationsResponse>(`/analytics/operations${toQueryString(query)}`, { token: authToken() });
}

export function getAnalyticsDestinations(query?: AnalyticsDateRangeQuery): Promise<AnalyticsDestinationsResponse> {
  return apiFetch<AnalyticsDestinationsResponse>(`/analytics/destinations${toQueryString(query)}`, { token: authToken() });
}

export function getAnalyticsCustomers(query?: AnalyticsDateRangeQuery): Promise<AnalyticsCustomersResponse> {
  return apiFetch<AnalyticsCustomersResponse>(`/analytics/customers${toQueryString(query)}`, { token: authToken() });
}

export function getAnalyticsExceptions(query?: AnalyticsDateRangeQuery): Promise<AnalyticsExceptionsResponse> {
  return apiFetch<AnalyticsExceptionsResponse>(`/analytics/exceptions${toQueryString(query)}`, { token: authToken() });
}
