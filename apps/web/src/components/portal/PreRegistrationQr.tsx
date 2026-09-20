import { QRCodeSVG } from 'qrcode.react';

/**
 * Customer Self-Service Pre-Registration, Stage 2: renders a submitted
 * pre-registration's reference as a QR code for the customer to show at
 * the warehouse. Deliberately a new, standalone component — NOT ItemLabel,
 * which is the *official* warehouse item label (barcode + QR encoding an
 * itemCode, printed for physical packages after staff verification). This
 * component only ever encodes the plain PRE-<year>-###### reference
 * string — the same value PreRegistrationsStaffController's `scan`
 * endpoint resolves by exact match — never a URL, never JSON, never any
 * other identifier, so "scan it" and "type it" always land on the exact
 * same lookup.
 */
export function PreRegistrationQr({ referenceNumber }: { referenceNumber: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-primary-200 bg-primary-50/60 p-6 text-center">
      <p className="text-sm font-medium text-slate-600">Reference</p>
      <p className="font-mono text-2xl font-bold tracking-wide text-slate-900">{referenceNumber}</p>
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <QRCodeSVG value={referenceNumber} size={180} aria-label={`QR code for ${referenceNumber}`} />
      </div>
      <p className="max-w-xs text-sm text-slate-600">Show this code when you arrive at the warehouse.</p>
    </div>
  );
}
