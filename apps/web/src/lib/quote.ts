import { ShipmentItemType, ShipmentMode, WebsiteLeadType } from '@transatlantic/shared';
import { createWebsiteLead } from './leads';
import { siteConfig } from './site-config';

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
 * Website Launch: submits the public Request-a-Quote form as a
 * WebsiteLead (type: QUOTE_REQUEST) — see leads.ts/apps/api/src/leads
 * for the real capture endpoint and staff-facing view. The structured
 * shipment fields go into quoteDetails (a flexible bag on the backend,
 * not real Shipment data); description/additionalNotes are combined into
 * one free-text message, matching WebsiteLead.message's own doc comment.
 */
export async function submitQuoteRequest(input: QuoteRequestInput): Promise<{ success: true }> {
  const message = [input.description, input.additionalNotes].filter((part) => part && part.trim()).join('\n\n');
  return createWebsiteLead({
    tenantSlug: siteConfig.tenantSlug,
    type: WebsiteLeadType.QUOTE_REQUEST,
    firstName: input.firstName,
    lastName: input.lastName || undefined,
    email: input.email,
    phone: input.phone || undefined,
    message: message || undefined,
    quoteDetails: {
      originCountry: input.originCountry || undefined,
      originCity: input.originCity || undefined,
      destinationCountry: input.destinationCountry || undefined,
      destinationCity: input.destinationCity || undefined,
      shipmentMode: input.shipmentMode || undefined,
      itemType: input.itemType || undefined,
      approximateWeight: input.approximateWeight || undefined,
      length: input.length || undefined,
      width: input.width || undefined,
      height: input.height || undefined,
    },
  });
}
