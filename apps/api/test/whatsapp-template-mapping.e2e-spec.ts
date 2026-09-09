import { ShipmentStatus } from '@transatlantic/shared';
import { buildShipmentStatusWhatsAppTemplate } from '../src/notifications/whatsapp-template.util';

jest.setTimeout(30_000);

/** WhatsApp Integration (Stage 4C) Phase 1 — pure-function test, no DB/app. */
describe('buildShipmentStatusWhatsAppTemplate — event-to-template mapping (e2e)', () => {
  const SUPPORTED_STATUSES = [
    ShipmentStatus.WAREHOUSE_RECEIVED,
    ShipmentStatus.DEPARTED,
    ShipmentStatus.ARRIVED_DESTINATION,
    ShipmentStatus.READY_FOR_PICKUP,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.COMPLETED,
  ];

  const UNSUPPORTED_STATUSES = [
    ShipmentStatus.DRAFT,
    ShipmentStatus.PROCESSING,
    ShipmentStatus.CUSTOMS_CLEARED, // notifiable for email — deliberately not yet WhatsApp-supported
    ShipmentStatus.CANCELLED,
  ];

  it('1. builds the correct template payload for every one of the 7 approved milestones', () => {
    for (const status of SUPPORTED_STATUSES) {
      const result = buildShipmentStatusWhatsAppTemplate(status, 'TAL-2026-000123', 'Some Label', 'shipment_status_update', 'en_US');
      expect(result).toEqual({
        name: 'shipment_status_update',
        language: 'en_US',
        params: ['TAL-2026-000123', 'Some Label'],
      });
    }
  });

  it('2. returns null for statuses outside the approved allow-list, including CUSTOMS_CLEARED which is notifiable for email', () => {
    for (const status of UNSUPPORTED_STATUSES) {
      const result = buildShipmentStatusWhatsAppTemplate(status, 'TAL-2026-000123', 'Some Label', 'shipment_status_update', 'en_US');
      expect(result).toBeNull();
    }
  });

  it('3. passes the configured template name/language through unchanged, not a hardcoded value', () => {
    const result = buildShipmentStatusWhatsAppTemplate(
      ShipmentStatus.DELIVERED,
      'TAL-2026-000999',
      'Delivered',
      'a_custom_template_name',
      'fr_FR',
    );
    expect(result).toEqual({ name: 'a_custom_template_name', language: 'fr_FR', params: ['TAL-2026-000999', 'Delivered'] });
  });
});
