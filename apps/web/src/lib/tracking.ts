import type { PublicTrackingResult } from '@transatlantic/shared';
import { apiFetch, ApiError } from './api';
import { siteConfig } from './site-config';

/**
 * Thin client for Stage 2A's public tracking API
 * (GET /tracking/public) — no business logic here, just the HTTP call
 * and mapping its outcomes to a shape the public /track page can render.
 * The curated projection (customer-safe labels, item summary, timeline)
 * is entirely computed server-side by TrackingService; this file must
 * never re-derive or duplicate any of that.
 */
export type TrackingLookupResult =
  | { found: true; result: PublicTrackingResult }
  | { found: false; message: string };

export async function lookupTrackingNumber(trackingNumber: string, lastName: string): Promise<TrackingLookupResult> {
  const query = new URLSearchParams({
    tenantSlug: siteConfig.tenantSlug,
    trackingNumber,
    lastName,
  });

  try {
    const result = await apiFetch<PublicTrackingResult>(`/tracking/public?${query.toString()}`);
    return { found: true, result };
  } catch (err) {
    if (err instanceof ApiError) {
      // 404 is the API's own generic, customer-safe "no match" message —
      // covers unknown tracking number, wrong last name, and unknown/
      // cross-tenant lookups identically, by design (see TrackingService).
      // Surface it verbatim; never substitute or embellish it.
      if (err.statusCode === 404) {
        return { found: false, message: err.message };
      }
      if (err.statusCode === 429) {
        return { found: false, message: 'Too many tracking attempts. Please wait a moment and try again.' };
      }
    }
    // Any other failure (network error, 5xx, etc.) — never surface the
    // raw technical error to a public, unauthenticated visitor.
    return {
      found: false,
      message: 'Something went wrong looking up that shipment. Please try again, or contact us with your tracking number.',
    };
  }
}
