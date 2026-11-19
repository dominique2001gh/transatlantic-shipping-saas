'use client';

import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { QRCodeSVG } from 'qrcode.react';

export interface ReceivingLabelData {
  internalReference: string;
  carrier: string;
  carrierTrackingNumber: string | null;
  customerName: string;
  description: string | null;
  quantity: number;
  /** Read from the authenticated tenant, never hardcoded — see useTenant(). */
  companyName: string;
}

/**
 * Warehouse Receiving Phase 1: an OPTIONAL internal label — printing this
 * is never required to save a receiving record (see this feature's own
 * "Option B" decision). Encodes the plain `internalReference` string
 * (e.g. "RCV-2026-000001"), lexically distinct from a ShipmentItem's
 * `itemCode` by its "RCV" prefix, so it can never be mistaken for, or
 * scanned into, the shipment/container/manifest flow — see
 * ReceivingRecord's own doc comment in schema.prisma. Deliberately a
 * separate component from ItemLabel.tsx rather than a reused one, so the
 * two label types can never visually or structurally drift into looking
 * identical.
 */
export function ReceivingLabel({ data }: { data: ReceivingLabelData }) {
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (barcodeRef.current) {
      JsBarcode(barcodeRef.current, data.internalReference, {
        format: 'CODE128',
        displayValue: false,
        height: 36,
        margin: 0,
      });
    }
  }, [data.internalReference]);

  return (
    <div className="item-label">
      <p className="item-label__company">{data.companyName}</p>
      <div className="item-label__receiver">
        <p className="item-label__receiver-tag">Internal Receiving — Not a Shipping Label</p>
        <p className="item-label__receiver-name">{data.customerName}</p>
      </div>
      <p className="item-label__tracking">{data.carrier}{data.carrierTrackingNumber ? ` — ${data.carrierTrackingNumber}` : ''}</p>
      <p className="item-label__sequence">Qty: {data.quantity}</p>
      {data.description && <p className="item-label__type">{data.description}</p>}
      <svg ref={barcodeRef} className="item-label__barcode" aria-label={`Barcode for ${data.internalReference}`} />
      <QRCodeSVG
        value={data.internalReference}
        size={72}
        className="item-label__qr"
        aria-label={`QR code for ${data.internalReference}`}
      />
      <p className="item-label__code">{data.internalReference}</p>
    </div>
  );
}
