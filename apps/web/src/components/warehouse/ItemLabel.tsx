'use client';

import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { QRCodeSVG } from 'qrcode.react';
import { humanizeEnumValue } from '@/lib/format';

export interface ItemLabelData {
  itemCode: string;
  itemType: string;
  description: string | null;
  sequenceNumber: number;
  totalItems: number;
  trackingNumber: string;
  destinationCountry: string;
  destinationLocation: string | null;
  /** Read from the authenticated tenant, never hardcoded — see useTenant(). */
  companyName: string;
  /**
   * Warehouse label legibility fix (2026-10): the consignee at
   * destination — same `Shipment.recipientName`/`recipientPhone` fields
   * already used elsewhere (destination receiving, pickup/delivery
   * dispatch, documents). Nullable because they're nullable at the DB
   * layer for any shipment created before these fields existed (see that
   * model's own doc comment) — never backfilled, so an old shipment's
   * label must still render without them.
   */
  recipientName: string | null;
  recipientPhone: string | null;
  /** The shipment's `customer` (sender/account holder) — distinct from the recipient above. Also nullable: some older/draft shipments may not have this relation resolved. */
  senderName: string | null;
}

/**
 * One printable shipment-item label. The QR and 1D barcode both encode
 * the plain itemCode string — the same value a keyboard-emulation
 * scanner would produce, and the same value `/warehouse/scan` resolves —
 * so any of "read the QR", "read the barcode", or "type the code by
 * hand" land on the exact same lookup path. Unchanged by the receiver-
 * legibility fix below: the encoded value is still only ever itemCode.
 *
 * Warehouse label legibility fix (2026-10): the receiver's name is now
 * the most visually prominent text on the label (see
 * .item-label__receiver-name), so staff can match a physical package to
 * a person without reading the smaller tracking/item details first.
 * Receiver phone and sender name are both shown too, deliberately
 * smaller, near the bottom. Still excludes declared value and internal
 * database ids — only what's needed to identify, contact about, and
 * route the physical package.
 */
export function ItemLabel({ data }: { data: ItemLabelData }) {
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (barcodeRef.current) {
      JsBarcode(barcodeRef.current, data.itemCode, {
        format: 'CODE128',
        displayValue: false,
        height: 36,
        margin: 0,
      });
    }
  }, [data.itemCode]);

  const destination = [data.destinationLocation, data.destinationCountry].filter(Boolean).join(', ');
  // Trimmed, not just truthy — a name/phone made of only whitespace (e.g.
  // a customer record with blank first/last name) must be treated as
  // absent, the same as null, rather than rendering an empty "Sender: "
  // line with nothing after it.
  const recipientName = data.recipientName?.trim() || null;
  const recipientPhone = data.recipientPhone?.trim() || null;
  const senderName = data.senderName?.trim() || null;

  return (
    <div className="item-label">
      <p className="item-label__company">{data.companyName}</p>
      <div className="item-label__receiver">
        <p className="item-label__receiver-tag">Receiver</p>
        <p className="item-label__receiver-name">{recipientName || '—'}</p>
      </div>
      <p className="item-label__tracking">{data.trackingNumber}</p>
      <p className="item-label__sequence">
        Item {data.sequenceNumber} of {data.totalItems}
      </p>
      <p className="item-label__type">
        {humanizeEnumValue(data.itemType)}
        {data.description ? ` — ${data.description}` : ''}
      </p>
      <p className="item-label__destination">Destination: {destination || '—'}</p>
      <svg ref={barcodeRef} className="item-label__barcode" aria-label={`Barcode for ${data.itemCode}`} />
      <QRCodeSVG value={data.itemCode} size={72} className="item-label__qr" aria-label={`QR code for ${data.itemCode}`} />
      <p className="item-label__code">{data.itemCode}</p>
      {recipientPhone && <p className="item-label__receiver-phone">Receiver Tel: {recipientPhone}</p>}
      {senderName && <p className="item-label__sender">Sender: {senderName}</p>}
    </div>
  );
}
