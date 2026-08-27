import { ShipmentItemType, ShipmentMode } from '@transatlantic/shared';

/**
 * Shape of a public quote request. Field names deliberately mirror the
 * future Quote/ShipmentItem Prisma models (see apps/api/prisma/schema.prisma)
 * so wiring this up to a real `POST /quotes` endpoint later is a
 * near-direct mapping rather than a redesign.
 */
export interface QuoteRequestInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  originCountry: string;
  originCity: string;
  destinationCountry: string;
  destinationCity: string;
  shipmentMode: ShipmentMode;
  itemType: ShipmentItemType;
  approximateWeight: string;
  length: string;
  width: string;
  height: string;
  description: string;
  additionalNotes: string;
}

export const SHIPMENT_MODE_LABELS: Record<ShipmentMode, string> = {
  [ShipmentMode.AIR]: 'Air Freight',
  [ShipmentMode.OCEAN_LCL]: 'Ocean LCL',
  [ShipmentMode.OCEAN_FCL]: 'Ocean FCL',
  [ShipmentMode.RORO]: 'RoRo / Vehicle Shipping',
};

export const ITEM_TYPE_LABELS: Record<ShipmentItemType, string> = {
  [ShipmentItemType.BOX]: 'Box',
  [ShipmentItemType.BARREL]: 'Barrel',
  [ShipmentItemType.PALLET]: 'Pallet',
  [ShipmentItemType.CRATE]: 'Crate',
  [ShipmentItemType.VEHICLE]: 'Vehicle',
  [ShipmentItemType.MACHINERY]: 'Machinery',
  [ShipmentItemType.HOUSEHOLD_GOODS]: 'Household Goods',
  [ShipmentItemType.OTHER]: 'Other',
};

/**
 * Submits a quote request.
 *
 * TODO(milestone 3+): replace this local simulation with a real call, e.g.
 *   return apiFetch('/quotes/public', { method: 'POST', body: JSON.stringify(input) });
 * once a public Quote-intake endpoint exists on the API. Kept as a stub
 * for now so the marketing site never pretends to reach a backend that
 * isn't there yet.
 */
export async function submitQuoteRequest(input: QuoteRequestInput): Promise<{ success: true }> {
  void input;
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { success: true };
}
