import { ShipmentMode } from '@transatlantic/shared';
import {
  buildShipmentTrackingUrl,
  shipmentArrivedEmail,
  shipmentDeliveredEmail,
  shipmentDepartedEmail,
  shipmentOutForDeliveryEmail,
  shipmentPickedUpEmail,
  shipmentReadyForPickupEmail,
  shipmentReceivedEmail,
  type ShipmentCustomerEmail,
  type ShipmentEmailTenantBranding,
} from '../src/notifications/templates/shipment-customer-emails';

jest.setTimeout(30_000);

/**
 * Customer Email Redesign — pure-function tests, no DB/app (same posture
 * as resend-email-header.e2e-spec.ts / whatsapp-template-mapping.e2e-spec.ts:
 * named .e2e-spec.ts only because that's this suite's one Jest entry point).
 * All DB-dependent behavior (tenant/customer lookup, ETA/pickup-location
 * resolution, the DELIVERED/COMPLETED dedup decision) is covered separately
 * in shipment-notification-emails.e2e-spec.ts, which does exercise a real
 * app + database.
 */

const BRANDED_TENANT: ShipmentEmailTenantBranding = {
  name: 'Some Other Shipping Co',
  legalName: 'Some Other Shipping Co, LLC',
  logoUrl: 'https://example.com/logo.png',
  primaryColor: '#123456',
  secondaryColor: '#654321',
  email: 'help@othertenant.example',
  phone: '+1 555-0100',
  website: 'https://othertenant.example',
};

const UNBRANDED_TENANT: ShipmentEmailTenantBranding = {
  name: 'Bare Tenant Co',
  legalName: null,
  logoUrl: null,
  primaryColor: null,
  secondaryColor: null,
  email: 'contact@bare.example',
  phone: null,
  website: null,
};

const TRACKING_NUMBER = 'TAL-2026-000007';
const TRACKING_URL = 'https://othertenant.example/track?tn=TAL-2026-000007';

/** No real English sentence contains an ALL_CAPS_WITH_UNDERSCORES token — this is the enum-leakage detector. */
const ENUM_LEAK_PATTERN = /\b[A-Z]{2,}_[A-Z_]+\b/;

function allSeven(): { name: string; email: ShipmentCustomerEmail }[] {
  const base = { trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: BRANDED_TENANT, trackingUrl: TRACKING_URL };
  return [
    { name: 'Received', email: shipmentReceivedEmail(base) },
    {
      name: 'Departed',
      email: shipmentDepartedEmail({ ...base, shipmentMode: ShipmentMode.OCEAN_FCL, destinationCountry: 'Ghana', estimatedArrival: null }),
    },
    { name: 'Arrived', email: shipmentArrivedEmail(base) },
    { name: 'ReadyForPickup', email: shipmentReadyForPickupEmail({ ...base, pickupLocation: null }) },
    { name: 'OutForDelivery', email: shipmentOutForDeliveryEmail(base) },
    { name: 'Delivered', email: shipmentDeliveredEmail(base) },
    { name: 'PickedUp', email: shipmentPickedUpEmail(base) },
  ];
}

describe('Shipment customer email templates (e2e)', () => {
  describe('Subjects match the exact approved copy', () => {
    it('1. Shipment Received', () => {
      const email = shipmentReceivedEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: BRANDED_TENANT, trackingUrl: TRACKING_URL });
      expect(email.subject).toBe(`We've received your shipment — ${TRACKING_NUMBER}`);
    });

    it('2. Shipment Departed', () => {
      const email = shipmentDepartedEmail({
        trackingNumber: TRACKING_NUMBER,
        customerFirstName: 'Jane',
        tenant: BRANDED_TENANT,
        trackingUrl: TRACKING_URL,
        shipmentMode: ShipmentMode.AIR,
        destinationCountry: 'Ghana',
        estimatedArrival: null,
      });
      expect(email.subject).toBe(`Your shipment is on its way — ${TRACKING_NUMBER}`);
    });

    it('3. Arrived at Destination', () => {
      const email = shipmentArrivedEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: BRANDED_TENANT, trackingUrl: TRACKING_URL });
      expect(email.subject).toBe(`Your shipment has arrived at its destination — ${TRACKING_NUMBER}`);
    });

    it('4A. Ready for Pickup', () => {
      const email = shipmentReadyForPickupEmail({
        trackingNumber: TRACKING_NUMBER,
        customerFirstName: 'Jane',
        tenant: BRANDED_TENANT,
        trackingUrl: TRACKING_URL,
        pickupLocation: null,
      });
      expect(email.subject).toBe(`Your shipment is ready for pickup — ${TRACKING_NUMBER}`);
    });

    it('4B. Out for Delivery', () => {
      const email = shipmentOutForDeliveryEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: BRANDED_TENANT, trackingUrl: TRACKING_URL });
      expect(email.subject).toBe(`Your shipment is out for delivery — ${TRACKING_NUMBER}`);
    });

    it('5A. Delivered', () => {
      const email = shipmentDeliveredEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: BRANDED_TENANT, trackingUrl: TRACKING_URL });
      expect(email.subject).toBe(`Your shipment has been delivered — ${TRACKING_NUMBER}`);
    });

    it('5B. Picked Up', () => {
      const email = shipmentPickedUpEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: BRANDED_TENANT, trackingUrl: TRACKING_URL });
      expect(email.subject).toBe(`Your shipment has been picked up — ${TRACKING_NUMBER}`);
    });
  });

  describe('No internal enum values ever leak to the customer', () => {
    it.each(allSeven())('$name: subject/text/html contain no ALL_CAPS_WITH_UNDERSCORES token', ({ email }) => {
      expect(email.subject).not.toMatch(ENUM_LEAK_PATTERN);
      expect(email.text).not.toMatch(ENUM_LEAK_PATTERN);
      expect(email.html).not.toMatch(ENUM_LEAK_PATTERN);
    });
  });

  describe('Tracking number is prominent everywhere', () => {
    it.each(allSeven())('$name: tracking number appears in subject, text, and html', ({ email }) => {
      expect(email.subject).toContain(TRACKING_NUMBER);
      expect(email.text).toContain(TRACKING_NUMBER);
      expect(email.html).toContain(TRACKING_NUMBER);
    });
  });

  describe('Customer name personalization', () => {
    it('uses the customer\'s first name when available', () => {
      const email = shipmentReceivedEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: BRANDED_TENANT, trackingUrl: TRACKING_URL });
      expect(email.text).toContain('Hi Jane,');
      expect(email.html).toContain('Hi Jane,');
    });

    it('falls back to a generic greeting when no name is on file', () => {
      const email = shipmentReceivedEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: null, tenant: BRANDED_TENANT, trackingUrl: TRACKING_URL });
      expect(email.text).toContain('Hi there,');
      expect(email.html).toContain('Hi there,');
      expect(email.text).not.toContain('null');
    });
  });

  describe('Tenant branding is used, never hardcoded to Trans Atlantic', () => {
    it('renders the tenant\'s own logo, name, and colors — not Trans Atlantic\'s', () => {
      const email = shipmentReceivedEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: BRANDED_TENANT, trackingUrl: TRACKING_URL });
      expect(email.html).toContain(BRANDED_TENANT.logoUrl!);
      expect(email.html).toContain(BRANDED_TENANT.primaryColor!);
      expect(email.html).toContain(BRANDED_TENANT.legalName!);
      expect(email.html).not.toMatch(/trans atlantic/i);
      expect(email.text).not.toMatch(/trans atlantic/i);
    });

    it('falls back gracefully when a tenant has configured no logo/colors/legal name/contact info', () => {
      const email = shipmentReceivedEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: UNBRANDED_TENANT, trackingUrl: null });
      // No <img> tag — falls back to a plain text brand mark using the tenant name.
      expect(email.html).not.toContain('<img');
      expect(email.html).toContain(UNBRANDED_TENANT.name);
      // Falls back to the tenant's plain `name`, never a null/undefined literal, when legalName is absent.
      expect(email.html).toContain(UNBRANDED_TENANT.name);
      expect(email.html).not.toContain('null');
      expect(email.text).not.toContain('null');
      expect(email.text).not.toContain('undefined');
      expect(email.html).not.toContain('undefined');
    });
  });

  describe('Track Your Shipment link', () => {
    it('renders the button/link when a tracking URL is available', () => {
      const email = shipmentReceivedEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: BRANDED_TENANT, trackingUrl: TRACKING_URL });
      expect(email.html).toContain(TRACKING_URL);
      expect(email.html).toContain('Track Your Shipment');
      expect(email.text).toContain(TRACKING_URL);
    });

    it('omits the button/link entirely when the tenant has no usable website — never fabricates a URL', () => {
      const email = shipmentReceivedEmail({ trackingNumber: TRACKING_NUMBER, customerFirstName: 'Jane', tenant: UNBRANDED_TENANT, trackingUrl: null });
      expect(email.html).not.toContain('Track Your Shipment');
      expect(email.text).not.toContain('Track your shipment:');
    });
  });

  describe('buildShipmentTrackingUrl', () => {
    it('builds a /track URL with only the tracking number as a query param — never the last name or any other value', () => {
      const url = buildShipmentTrackingUrl('https://othertenant.example', TRACKING_NUMBER);
      expect(url).not.toBeNull();
      const parsed = new URL(url!);
      expect(parsed.pathname).toBe('/track');
      expect(Array.from(parsed.searchParams.keys())).toEqual(['tn']);
      expect(parsed.searchParams.get('tn')).toBe(TRACKING_NUMBER);
    });

    it('handles a website with a trailing slash without producing a double slash', () => {
      const url = buildShipmentTrackingUrl('https://othertenant.example/', TRACKING_NUMBER);
      expect(new URL(url!).pathname).toBe('/track');
    });

    it('returns null (never guesses a URL) when the tenant has no website configured', () => {
      expect(buildShipmentTrackingUrl(null, TRACKING_NUMBER)).toBeNull();
      expect(buildShipmentTrackingUrl(undefined, TRACKING_NUMBER)).toBeNull();
      expect(buildShipmentTrackingUrl('   ', TRACKING_NUMBER)).toBeNull();
    });

    it('returns null for a malformed website value rather than throwing or fabricating a URL', () => {
      expect(buildShipmentTrackingUrl('not a url', TRACKING_NUMBER)).toBeNull();
    });
  });

  describe('Departed: mode/destination/ETA — never invented', () => {
    it('includes mode and destination always', () => {
      const email = shipmentDepartedEmail({
        trackingNumber: TRACKING_NUMBER,
        customerFirstName: 'Jane',
        tenant: BRANDED_TENANT,
        trackingUrl: TRACKING_URL,
        shipmentMode: ShipmentMode.OCEAN_LCL,
        destinationCountry: 'Ghana',
        estimatedArrival: null,
      });
      expect(email.html).toContain('Ghana');
      expect(email.html).toMatch(/Ocean Freight \(LCL\)/);
      expect(email.text).toContain('Ghana');
    });

    it('includes an estimated arrival date only when one is actually supplied', () => {
      const withEta = shipmentDepartedEmail({
        trackingNumber: TRACKING_NUMBER,
        customerFirstName: 'Jane',
        tenant: BRANDED_TENANT,
        trackingUrl: TRACKING_URL,
        shipmentMode: ShipmentMode.AIR,
        destinationCountry: 'Ghana',
        estimatedArrival: new Date('2026-09-20T00:00:00.000Z'),
      });
      expect(withEta.html).toMatch(/Estimated Arrival/);
      expect(withEta.text).toMatch(/Estimated Arrival/);

      const withoutEta = shipmentDepartedEmail({
        trackingNumber: TRACKING_NUMBER,
        customerFirstName: 'Jane',
        tenant: BRANDED_TENANT,
        trackingUrl: TRACKING_URL,
        shipmentMode: ShipmentMode.AIR,
        destinationCountry: 'Ghana',
        estimatedArrival: null,
      });
      expect(withoutEta.html).not.toMatch(/Estimated Arrival/);
      expect(withoutEta.text).not.toMatch(/Estimated Arrival/);
    });
  });

  describe('Ready for Pickup: location shown only when configured, hours/instructions never invented', () => {
    it('includes the pickup location/address when supplied', () => {
      const email = shipmentReadyForPickupEmail({
        trackingNumber: TRACKING_NUMBER,
        customerFirstName: 'Jane',
        tenant: BRANDED_TENANT,
        trackingUrl: TRACKING_URL,
        pickupLocation: {
          name: 'Accra Destination Warehouse',
          addressLine1: '123 Harbour Rd',
          addressLine2: null,
          city: 'Tema',
          state: null,
          country: 'Ghana',
          postalCode: null,
          phone: '+233 20 000 0000',
        },
      });
      expect(email.html).toContain('Accra Destination Warehouse');
      expect(email.html).toContain('123 Harbour Rd');
      expect(email.text).toContain('Accra Destination Warehouse');
    });

    it('omits the location block entirely when no destination warehouse is available — and never invents hours or instructions', () => {
      const email = shipmentReadyForPickupEmail({
        trackingNumber: TRACKING_NUMBER,
        customerFirstName: 'Jane',
        tenant: BRANDED_TENANT,
        trackingUrl: TRACKING_URL,
        pickupLocation: null,
      });
      expect(email.html).not.toContain('Pickup Location');
      expect(email.html).not.toMatch(/hours/i);
      expect(email.html).not.toMatch(/instructions/i);
      expect(email.text).not.toMatch(/hours/i);
      expect(email.text).not.toMatch(/instructions/i);
    });
  });

  describe('Plain-text fallback quality', () => {
    it.each(allSeven())('$name: plain text has no HTML tags and includes tenant contact info', ({ email }) => {
      expect(email.text).not.toMatch(/<[a-z][\s\S]*>/i);
      expect(email.text).toContain(BRANDED_TENANT.phone!);
      expect(email.text).toContain(BRANDED_TENANT.email);
      expect(email.text).toContain(BRANDED_TENANT.website!);
    });
  });

  describe('No staff/internal detail ever appears', () => {
    it.each(allSeven())('$name: never mentions staff, warehouse-internal, or database-id language', ({ email }) => {
      for (const forbidden of ['userId', 'warehouseId', 'shipmentId', 'staff', 'employee']) {
        expect(email.html.toLowerCase()).not.toContain(forbidden.toLowerCase());
        expect(email.text.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });
  });
});
