export interface TrackingLookupResult {
  available: false;
  message: string;
}

/**
 * Looks up a shipment by tracking number for the public tracking page.
 *
 * There is no public tracking endpoint yet, so this deliberately never
 * fabricates shipment status — it always returns a clear "not connected
 * yet" result. Once a real `GET /tracking/:trackingNumber` endpoint
 * exists, replace the body with an `apiFetch` call and widen the return
 * type to include real shipment/tracking-event data.
 */
export async function lookupTrackingNumber(trackingNumber: string): Promise<TrackingLookupResult> {
  void trackingNumber;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    available: false,
    message:
      'Online tracking is being connected to our systems and will be available soon. In the meantime, contact us with your tracking number for a status update.',
  };
}
