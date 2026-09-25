import { ShipmentStatus } from '@transatlantic/shared';
import { buildShipmentSmsBody, isSmsSupportedShipmentStatus } from '../src/notifications/shipment-sms.util';

jest.setTimeout(30_000);

/**
 * SMS/Twilio MVP — pure-function test, no DB/app, mirrors
 * whatsapp-template-mapping.e2e-spec.ts's own structure for the equivalent
 * WhatsApp allow-list.
 */
describe('buildShipmentSmsBody / isSmsSupportedShipmentStatus — milestone mapping (e2e)', () => {
  const SUPPORTED_STATUSES = [
    ShipmentStatus.WAREHOUSE_RECEIVED,
    ShipmentStatus.DEPARTED,
    ShipmentStatus.ARRIVED_DESTINATION,
    ShipmentStatus.READY_FOR_PICKUP,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.COMPLETED,
  ];

  const UNSUPPORTED_STATUSES = [
    ShipmentStatus.DRAFT,
    ShipmentStatus.PROCESSING,
    ShipmentStatus.READY_FOR_CONSOLIDATION,
    ShipmentStatus.CONSOLIDATED,
    ShipmentStatus.BOOKED,
    ShipmentStatus.LOADED,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.CUSTOMS_PROCESSING,
    ShipmentStatus.CUSTOMS_CLEARED, // notifiable for email/WhatsApp — deliberately not SMS-supported yet
    ShipmentStatus.OUT_FOR_DELIVERY, // notifiable for email/WhatsApp — deliberately not SMS-supported yet
    ShipmentStatus.CANCELLED,
  ];

  it('1. isSmsSupportedShipmentStatus is true for exactly the 5 approved milestones (DELIVERED and COMPLETED both count)', () => {
    for (const status of SUPPORTED_STATUSES) {
      expect(isSmsSupportedShipmentStatus(status)).toBe(true);
    }
  });

  it('2. isSmsSupportedShipmentStatus is false for every other status, including ones notifiable for email/WhatsApp', () => {
    for (const status of UNSUPPORTED_STATUSES) {
      expect(isSmsSupportedShipmentStatus(status)).toBe(false);
    }
  });

  it('3. returns null (no SMS) for an unsupported status', () => {
    const result = buildShipmentSmsBody({
      tenantName: 'Trans Atlantic Logistics Solutions',
      trackingNumber: 'TAL-2026-000123',
      status: ShipmentStatus.PROCESSING,
      trackingUrl: 'https://talogisticssolutions.com/track?tn=TAL-2026-000123',
    });
    expect(result).toBeNull();
  });

  it('4. builds tenant-branded, tracking-number-inclusive copy for each of the 5 supported milestones', () => {
    for (const status of SUPPORTED_STATUSES) {
      const body = buildShipmentSmsBody({
        tenantName: 'Trans Atlantic Logistics Solutions',
        trackingNumber: 'TAL-2026-000123',
        status,
        trackingUrl: 'https://talogisticssolutions.com/track?tn=TAL-2026-000123',
      });
      expect(body).not.toBeNull();
      expect(body).toContain('Trans Atlantic Logistics Solutions');
      expect(body).toContain('TAL-2026-000123');
      expect(body).toContain('https://talogisticssolutions.com/track?tn=TAL-2026-000123');
      // Never branded as the platform — this is the whole point of Phase 3.
      expect(body).not.toMatch(/Ananse/i);
    }
  });

  it('5. a different tenant name produces correspondingly different branding, never a hardcoded tenant', () => {
    const body = buildShipmentSmsBody({
      tenantName: 'Golden Star Shipping',
      trackingNumber: 'GSS-000001',
      status: ShipmentStatus.ARRIVED_DESTINATION,
      trackingUrl: 'https://goldenstarshipping.example/track?tn=GSS-000001',
    });
    expect(body).toContain('Golden Star Shipping');
    expect(body).not.toContain('Trans Atlantic');
    expect(body).not.toMatch(/Ananse/i);
  });

  it('6. omits the tracking line entirely (never a broken/empty link) when no trackingUrl is available', () => {
    const body = buildShipmentSmsBody({
      tenantName: 'Trans Atlantic Logistics Solutions',
      trackingNumber: 'TAL-2026-000123',
      status: ShipmentStatus.DEPARTED,
      trackingUrl: null,
    });
    expect(body).not.toBeNull();
    expect(body).not.toContain('Track:');
    expect(body).not.toContain('null');
  });

  it('7. every supported-milestone body is GSM-7-safe (no smart quotes, em dashes, or emoji) and reasonably short', () => {
    for (const status of SUPPORTED_STATUSES) {
      const body = buildShipmentSmsBody({
        tenantName: 'Trans Atlantic Logistics Solutions',
        trackingNumber: 'TAL-2026-000123',
        status,
        trackingUrl: 'https://talogisticssolutions.com/track?tn=TAL-2026-000123',
      })!;
      expect(/[‘’“”—–]/.test(body)).toBe(false); // curly quotes / em/en dash
      expect(/\p{Emoji_Presentation}/u.test(body)).toBe(false);
      // Body-only length (excluding the tenant-name/URL portion, which varies per tenant) stays terse.
      expect(body.length).toBeLessThan(220);
    }
  });

  it('8. DELIVERED and COMPLETED produce distinct final-milestone wording (never identical text for two different real-world events)', () => {
    const delivered = buildShipmentSmsBody({
      tenantName: 'Trans Atlantic Logistics Solutions',
      trackingNumber: 'TAL-2026-000123',
      status: ShipmentStatus.DELIVERED,
      trackingUrl: null,
    });
    const completed = buildShipmentSmsBody({
      tenantName: 'Trans Atlantic Logistics Solutions',
      trackingNumber: 'TAL-2026-000123',
      status: ShipmentStatus.COMPLETED,
      trackingUrl: null,
    });
    expect(delivered).not.toEqual(completed);
  });
});
