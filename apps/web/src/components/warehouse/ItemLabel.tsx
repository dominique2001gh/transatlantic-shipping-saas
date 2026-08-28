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
}

/**
 * One printable shipment-item label. The QR and 1D barcode both encode
 * the plain itemCode string — the same value a keyboard-emulation
 * scanner would produce, and the same value `/warehouse/scan` resolves —
 * so any of "read the QR", "read the barcode", or "type the code by
 * hand" land on the exact same lookup path.
 *
 * Deliberately excludes customer contact details, declared value, and
 * internal database ids — only what's needed to identify and route the
 * physical package.
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

  return (
    <div className="item-label">
      <p className="item-label__company">{data.companyName}</p>
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
    </div>
  );
}
