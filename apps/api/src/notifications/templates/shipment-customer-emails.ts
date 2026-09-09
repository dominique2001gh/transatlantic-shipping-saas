import type { ShipmentMode } from '@transatlantic/shared';

/**
 * Customer Email Redesign: professional, tenant-branded HTML (+ plain-text
 * fallback) for the 5 major shipment-lifecycle customer emails (7 template
 * functions — READY_FOR_PICKUP/OUT_FOR_DELIVERY and DELIVERED/PICKED_UP are
 * each two variants of one stage, not six separate architectures).
 *
 * Every function here is a pure function: given plain data (never a Prisma
 * client, never a request), it returns `{ subject, text, html }`. All DB
 * lookups (tenant branding, customer name, ETA, pickup address, the
 * DELIVERED-vs-COMPLETED dedup decision) live in NotificationsService —
 * this file only renders. That split is what makes this trivially testable
 * without a database (see shipment-customer-emails.e2e-spec.ts).
 *
 * Deliberately separate from ../templates/platform-emails.ts — that file is
 * AnanseLogix-the-platform emailing a *tenant* about their own account;
 * this file is a tenant emailing *their own shipping customer*, branded
 * with that tenant's own name/logo/colors, never AnanseLogix's.
 *
 * Hard rules enforced by construction here:
 *   - No internal enum value (ARRIVED_DESTINATION, READY_FOR_PICKUP, ...)
 *     ever appears in subject or body — every string here is hand-written
 *     customer language.
 *   - No tenant is hardcoded — every piece of branding/contact info comes
 *     from the `tenant` param, with a neutral fallback when a tenant
 *     hasn't configured logo/colors.
 *   - No staff identity, warehouse-internal detail, database ids, or
 *     operational reason codes are ever included.
 *   - Optional detail (ETA, pickup address) is only ever rendered when the
 *     caller actually supplies it — never fabricated here.
 */

export interface ShipmentEmailTenantBranding {
  name: string;
  legalName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  email: string;
  phone?: string | null;
  website?: string | null;
}

export interface ShipmentEmailPickupLocation {
  name: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state?: string | null;
  country: string;
  postalCode?: string | null;
  phone?: string | null;
}

export interface ShipmentCustomerEmail {
  subject: string;
  text: string;
  html: string;
}

interface BaseParams {
  trackingNumber: string;
  customerFirstName?: string | null;
  tenant: ShipmentEmailTenantBranding;
  /** Null when the tenant has no usable public website configured — the button/link is omitted entirely rather than guessing a URL. */
  trackingUrl: string | null;
}

const DEFAULT_ACCENT = '#0f172a';

const SHIPMENT_MODE_LABELS: Record<ShipmentMode, string> = {
  AIR: 'Air Freight',
  OCEAN_LCL: 'Ocean Freight (LCL)',
  OCEAN_FCL: 'Ocean Freight (FCL)',
  RORO: 'RoRo (Roll-on/Roll-off)',
};

/**
 * Builds the public tracking link for one tenant/tracking number, or null
 * if this tenant has no usable public website on file — never fabricates
 * or guesses a URL. Appends `?tn=<trackingNumber>` only; the customer's
 * last name is never included in a link (see TrackingForm's own doc
 * comment for why that specific field must never appear in a URL).
 */
export function buildShipmentTrackingUrl(website: string | null | undefined, trackingNumber: string): string | null {
  const trimmed = website?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/track`;
    url.search = '';
    url.searchParams.set('tn', trackingNumber);
    return url.toString();
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function greetingFor(firstName?: string | null): string {
  const trimmed = firstName?.trim();
  return trimmed ? `Hi ${trimmed},` : 'Hi there,';
}

/**
 * An ETA is a calendar date, not a specific moment — formatted in UTC
 * explicitly so the day shown never shifts depending on which timezone
 * the API server process happens to be running in (a `DateTime` stored as
 * e.g. midnight UTC must never display as "the day before" just because a
 * server is in a negative UTC offset).
 */
function formatEtaDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// HTML shell
// ---------------------------------------------------------------------------

function renderHeaderRow(tenant: ShipmentEmailTenantBranding, accent: string): string {
  const brandMark = tenant.logoUrl
    ? `<img src="${escapeHtml(tenant.logoUrl)}" alt="${escapeHtml(tenant.name)}" style="max-height:40px;max-width:240px;display:block;border:0;" />`
    : `<span style="font-size:20px;font-weight:700;color:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(tenant.name)}</span>`;
  return `<tr><td style="background-color:${accent};padding:20px 32px;border-radius:8px 8px 0 0;">${brandMark}</td></tr>`;
}

function renderTrackingBlock(trackingNumber: string, accent: string): string {
  return `
    <tr>
      <td style="padding:24px 32px 0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
          <tr>
            <td style="padding:14px 18px;">
              <p style="margin:0;font-size:12px;letter-spacing:0.05em;text-transform:uppercase;color:#64748b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Tracking Number</p>
              <p style="margin:4px 0 0 0;font-size:18px;font-weight:700;color:${accent};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(trackingNumber)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderButtonRow(trackingUrl: string | null, accent: string): string {
  if (!trackingUrl) return '';
  return `
    <tr>
      <td style="padding:24px 32px 0 32px;">
        <a href="${escapeHtml(trackingUrl)}" style="display:inline-block;background-color:${accent};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Track Your Shipment</a>
      </td>
    </tr>`;
}

function renderFooterRow(tenant: ShipmentEmailTenantBranding): string {
  const contactLines = [tenant.phone, tenant.email, tenant.website].filter((v): v is string => !!v?.trim());
  return `
    <tr>
      <td style="padding:28px 32px 24px 32px;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#94a3b8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(tenant.legalName?.trim() || tenant.name)}</p>
        ${contactLines.map((line) => `<p style="margin:2px 0 0 0;font-size:12px;color:#94a3b8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(line)}</p>`).join('')}
      </td>
    </tr>`;
}

function renderShell(params: {
  tenant: ShipmentEmailTenantBranding;
  trackingNumber: string;
  trackingUrl: string | null;
  heading: string;
  greeting: string;
  /** Already-safe HTML fragments (callers escape any dynamic value before interpolating) — one <p> per entry. */
  paragraphsHtml: string[];
  /** Optional stage-specific detail block (ETA, pickup address) rendered between the intro paragraphs and the tracking-number block. */
  detailsHtml?: string;
}): string {
  const accent = params.tenant.primaryColor?.trim() || DEFAULT_ACCENT;
  const paragraphs = [params.greeting, ...params.paragraphsHtml]
    .map((p) => `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.5;color:#1e293b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${p}</p>`)
    .join('');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background-color:#f1f5f9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
            ${renderHeaderRow(params.tenant, accent)}
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;color:#0f172a;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(params.heading)}</h1>
                ${paragraphs}
              </td>
            </tr>
            ${params.detailsHtml ?? ''}
            ${renderTrackingBlock(params.trackingNumber, accent)}
            ${renderButtonRow(params.trackingUrl, accent)}
            ${renderFooterRow(params.tenant)}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ---------------------------------------------------------------------------
// Plain-text fallback
// ---------------------------------------------------------------------------

function renderPlainText(params: {
  greeting: string;
  heading: string;
  paragraphs: string[];
  trackingNumber: string;
  trackingUrl: string | null;
  detailsLines?: string[];
  tenant: ShipmentEmailTenantBranding;
}): string {
  const lines = [params.greeting, '', params.heading, '', ...params.paragraphs];
  if (params.detailsLines?.length) {
    lines.push('', ...params.detailsLines);
  }
  lines.push('', `Tracking Number: ${params.trackingNumber}`);
  if (params.trackingUrl) {
    lines.push('', `Track your shipment: ${params.trackingUrl}`);
  }
  lines.push('', '—', params.tenant.legalName?.trim() || params.tenant.name);
  for (const line of [params.tenant.phone, params.tenant.email, params.tenant.website]) {
    if (line?.trim()) lines.push(line);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 1. Shipment Received (WAREHOUSE_RECEIVED)
// ---------------------------------------------------------------------------

export function shipmentReceivedEmail(params: BaseParams): ShipmentCustomerEmail {
  const greeting = greetingFor(params.customerFirstName);
  const heading = "We've received your shipment";
  const paragraphsHtml = [
    'Good news — your shipment has been received at our origin warehouse and is now in our system.',
    'You can use the tracking number below to follow your shipment throughout its journey, from processing all the way through to delivery or pickup.',
  ];
  return {
    subject: `We've received your shipment — ${params.trackingNumber}`,
    html: renderShell({ tenant: params.tenant, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, heading, greeting, paragraphsHtml }),
    text: renderPlainText({ greeting, heading, paragraphs: paragraphsHtml, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, tenant: params.tenant }),
  };
}

// ---------------------------------------------------------------------------
// 2. Shipment Departed (DEPARTED)
// ---------------------------------------------------------------------------

export function shipmentDepartedEmail(
  params: BaseParams & { shipmentMode: ShipmentMode; destinationCountry: string; estimatedArrival: Date | null },
): ShipmentCustomerEmail {
  const greeting = greetingFor(params.customerFirstName);
  const heading = 'Your shipment is on its way';
  const modeLabel = SHIPMENT_MODE_LABELS[params.shipmentMode] ?? 'transit';
  const paragraphsHtml = [
    `Your shipment has departed our origin facility and is on its way to <strong>${escapeHtml(params.destinationCountry)}</strong> via ${escapeHtml(modeLabel)}.`,
  ];
  const detailLines: { label: string; value: string }[] = [
    { label: 'Mode', value: modeLabel },
    { label: 'Destination', value: params.destinationCountry },
  ];
  if (params.estimatedArrival) {
    detailLines.push({ label: 'Estimated Arrival', value: formatEtaDate(params.estimatedArrival) });
  }
  const detailsHtml = renderDetailsTable(detailLines);
  return {
    subject: `Your shipment is on its way — ${params.trackingNumber}`,
    html: renderShell({ tenant: params.tenant, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, heading, greeting, paragraphsHtml, detailsHtml }),
    text: renderPlainText({
      greeting,
      heading,
      paragraphs: [`Your shipment has departed our origin facility and is on its way to ${params.destinationCountry} via ${modeLabel}.`],
      detailsLines: detailLines.map((d) => `${d.label}: ${d.value}`),
      trackingNumber: params.trackingNumber,
      trackingUrl: params.trackingUrl,
      tenant: params.tenant,
    }),
  };
}

// ---------------------------------------------------------------------------
// 3. Arrived at Destination (ARRIVED_DESTINATION)
// ---------------------------------------------------------------------------

export function shipmentArrivedEmail(params: BaseParams): ShipmentCustomerEmail {
  const greeting = greetingFor(params.customerFirstName);
  const heading = 'Your shipment has arrived at its destination';
  // Deliberately never mentions pickup/delivery readiness here — that is a
  // separate, independently-triggered milestone (READY_FOR_PICKUP /
  // OUT_FOR_DELIVERY) with its own email; conflating the two would tell a
  // customer something that hasn't actually happened yet.
  const paragraphsHtml = [
    'Your shipment has arrived at its destination facility and is being processed.',
    "We'll send you another update as soon as it's ready for the next step.",
  ];
  return {
    subject: `Your shipment has arrived at its destination — ${params.trackingNumber}`,
    html: renderShell({ tenant: params.tenant, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, heading, greeting, paragraphsHtml }),
    text: renderPlainText({ greeting, heading, paragraphs: paragraphsHtml, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, tenant: params.tenant }),
  };
}

// ---------------------------------------------------------------------------
// 4A. Ready for Pickup (READY_FOR_PICKUP)
// ---------------------------------------------------------------------------

export function shipmentReadyForPickupEmail(params: BaseParams & { pickupLocation: ShipmentEmailPickupLocation | null }): ShipmentCustomerEmail {
  const greeting = greetingFor(params.customerFirstName);
  const heading = 'Your shipment is ready for pickup';
  const paragraphsHtml = ['Your shipment is ready for collection.'];
  let detailsHtml: string | undefined;
  const textDetailLines: string[] = [];
  if (params.pickupLocation) {
    const loc = params.pickupLocation;
    const addressParts = [loc.addressLine1, loc.addressLine2, [loc.city, loc.state].filter(Boolean).join(', '), loc.postalCode, loc.country].filter(
      (part): part is string => !!part?.trim(),
    );
    detailsHtml = renderDetailsTable([
      { label: 'Pickup Location', value: loc.name },
      { label: 'Address', value: addressParts.join(', ') },
      ...(loc.phone ? [{ label: 'Phone', value: loc.phone }] : []),
    ]);
    textDetailLines.push(`Pickup Location: ${loc.name}`, `Address: ${addressParts.join(', ')}`);
    if (loc.phone) textDetailLines.push(`Phone: ${loc.phone}`);
  }
  // No pickup hours/instructions field exists in this system today — never
  // invented here; only genuinely configured location data is shown.
  return {
    subject: `Your shipment is ready for pickup — ${params.trackingNumber}`,
    html: renderShell({ tenant: params.tenant, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, heading, greeting, paragraphsHtml, detailsHtml }),
    text: renderPlainText({
      greeting,
      heading,
      paragraphs: paragraphsHtml,
      detailsLines: textDetailLines.length > 0 ? textDetailLines : undefined,
      trackingNumber: params.trackingNumber,
      trackingUrl: params.trackingUrl,
      tenant: params.tenant,
    }),
  };
}

// ---------------------------------------------------------------------------
// 4B. Out for Delivery (OUT_FOR_DELIVERY)
// ---------------------------------------------------------------------------

export function shipmentOutForDeliveryEmail(params: BaseParams): ShipmentCustomerEmail {
  const greeting = greetingFor(params.customerFirstName);
  const heading = 'Your shipment is out for delivery';
  const paragraphsHtml = ['Your shipment is out for delivery today.'];
  return {
    subject: `Your shipment is out for delivery — ${params.trackingNumber}`,
    html: renderShell({ tenant: params.tenant, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, heading, greeting, paragraphsHtml }),
    text: renderPlainText({ greeting, heading, paragraphs: paragraphsHtml, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, tenant: params.tenant }),
  };
}

// ---------------------------------------------------------------------------
// 5A. Delivered (DELIVERED)
// ---------------------------------------------------------------------------

export function shipmentDeliveredEmail(params: BaseParams): ShipmentCustomerEmail {
  const greeting = greetingFor(params.customerFirstName);
  const heading = 'Your shipment has been delivered';
  const paragraphsHtml = ['Your shipment has been successfully delivered. Thank you for shipping with us!'];
  return {
    subject: `Your shipment has been delivered — ${params.trackingNumber}`,
    html: renderShell({ tenant: params.tenant, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, heading, greeting, paragraphsHtml }),
    text: renderPlainText({ greeting, heading, paragraphs: paragraphsHtml, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, tenant: params.tenant }),
  };
}

// ---------------------------------------------------------------------------
// 5B. Picked Up — the COMPLETED-triggered variant for a pure customer
// pickup (no driver DELIVERY ever occurred for this shipment). See
// NotificationsService.buildShipmentEmailContent's own doc comment for how
// this is disambiguated from the redundant COMPLETED-after-DELIVERED case,
// which is suppressed entirely rather than templated.
// ---------------------------------------------------------------------------

export function shipmentPickedUpEmail(params: BaseParams): ShipmentCustomerEmail {
  const greeting = greetingFor(params.customerFirstName);
  const heading = 'Your shipment has been picked up';
  const paragraphsHtml = ['Your shipment has been successfully picked up. Thank you for shipping with us!'];
  return {
    subject: `Your shipment has been picked up — ${params.trackingNumber}`,
    html: renderShell({ tenant: params.tenant, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, heading, greeting, paragraphsHtml }),
    text: renderPlainText({ greeting, heading, paragraphs: paragraphsHtml, trackingNumber: params.trackingNumber, trackingUrl: params.trackingUrl, tenant: params.tenant }),
  };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function renderDetailsTable(rows: { label: string; value: string }[]): string {
  if (rows.length === 0) return '';
  const rowsHtml = rows
    .map(
      (row) => `
          <tr>
            <td style="padding:6px 0;font-size:13px;color:#64748b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;width:140px;">${escapeHtml(row.label)}</td>
            <td style="padding:6px 0;font-size:13px;color:#1e293b;font-weight:600;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(row.value)}</td>
          </tr>`,
    )
    .join('');
  return `
    <tr>
      <td style="padding:8px 32px 0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${rowsHtml}
        </table>
      </td>
    </tr>`;
}
