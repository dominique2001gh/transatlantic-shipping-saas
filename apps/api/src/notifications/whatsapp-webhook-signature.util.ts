import { createHmac, timingSafeEqual } from 'crypto';

/**
 * WhatsApp Integration (Stage 4C) Phase 2: verifies Meta's
 * `X-Hub-Signature-256` header — the standard Graph API webhook
 * authenticity mechanism (identical scheme across every Graph API
 * product, not WhatsApp-specific). Meta computes `sha256=<hex-hmac>` over
 * the *exact raw request bytes* using the app's own App Secret; this must
 * be verified against `rawBody` (see main.ts's `rawBody: true`), never a
 * JSON-parsed-then-reserialized body, for the same reason
 * StripeService.constructWebhookEvent already requires Stripe's raw body.
 *
 * Deliberately pure and side-effect-free (no throwing, no logging) —
 * returns a plain boolean so the controller decides what to log/respond,
 * and this stays trivially unit-testable in isolation.
 *
 * Uses `timingSafeEqual` (not `===`) so a byte-by-byte comparison can
 * never leak timing information about how much of a guessed signature
 * was correct — the same discipline any HMAC comparison needs.
 */
export function verifyMetaWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader) {
    return false;
  }
  const [algorithm, providedHex] = signatureHeader.split('=');
  if (algorithm !== 'sha256' || !providedHex) {
    return false;
  }

  const expectedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  const providedBuffer = Buffer.from(providedHex, 'hex');
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false — a malformed/truncated header must fail closed, not throw
  // past this function's own no-throw contract.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
