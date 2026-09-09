import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

/**
 * WhatsApp Integration (Stage 4C): normalizes/validates a customer phone
 * number to E.164 (e.g. "+233201234567") before it's ever handed to a
 * WhatsApp provider — Meta's Cloud API rejects anything else outright.
 *
 * Deliberately pure and side-effect-free (no throwing) — returns `null`
 * for anything unparseable/invalid rather than raising, so callers treat
 * "bad number on file" as ordinary data to handle (mark that one
 * Notification FAILED with a clear reason), never as an exception that
 * could propagate up and interrupt the shipment-lifecycle action that
 * triggered the notification in the first place.
 *
 * `defaultCountry` (an ISO 3166-1 alpha-2 code, e.g. "GH", "US") is only
 * consulted when `rawPhone` has no leading "+" — libphonenumber-js cannot
 * otherwise know which country's numbering plan a bare local-format
 * number belongs to. Callers pass the customer's own tenant's `country`
 * field (already on the Tenant model) as this hint — never a hardcoded
 * country — so this stays correct for any tenant's own customer base, not
 * just Trans Atlantic's. A number that already includes a country code
 * (the common case once customers learn to type "+233...") normalizes
 * correctly regardless of `defaultCountry`.
 */
export function normalizeToE164(rawPhone: string | null | undefined, defaultCountry?: string | null): string | null {
  const trimmed = rawPhone?.trim();
  if (!trimmed) {
    return null;
  }

  // A loose runtime shape-check, not a membership check against
  // libphonenumber-js's full CountryCode union — an unrecognized code
  // still parses safely (the library itself rejects it internally),
  // this cast only silences the type-level mismatch between our plain
  // `string | null` DB field and the library's closed string-literal type.
  const country = isSupportedCountryCode(defaultCountry) ? (defaultCountry as CountryCode) : undefined;

  try {
    const parsed = parsePhoneNumberFromString(trimmed, country);
    if (!parsed || !parsed.isValid()) {
      return null;
    }
    return parsed.number; // libphonenumber-js's own `.number` is always E.164-formatted.
  } catch {
    // parsePhoneNumberFromString throws on a small class of malformed
    // inputs (e.g. way too long) rather than returning undefined for
    // them — treated identically to "invalid", never propagated.
    return null;
  }
}

/**
 * libphonenumber-js's CountryCode type is a large closed union of real
 * ISO 3166-1 alpha-2 codes; this loose runtime check (2 uppercase
 * letters) is intentionally permissive rather than importing/maintaining
 * that whole union here — an invalid/unrecognized code is simply treated
 * as "no hint available" (falls through to undefined) by the caller
 * above, never a thrown error.
 */
function isSupportedCountryCode(value: string | null | undefined): value is string {
  return !!value && /^[A-Z]{2}$/.test(value);
}
