import { createHmac, timingSafeEqual } from 'crypto';

/**
 * SMS/Twilio A2P Phase 1: verifies Twilio's `X-Twilio-Signature` header on
 * inbound SMS webhooks (STOP/START/HELP). Twilio's documented algorithm
 * (https://www.twilio.com/docs/usage/webhooks/webhooks-security): take the
 * exact URL Twilio was configured to call, append every POST parameter's
 * key immediately followed by its value (no delimiter) in ascending key
 * order, then HMAC-SHA1 the result with the Auth Token and base64-encode —
 * this operates on the already-decoded param values (unlike Stripe/Meta's
 * raw-body-based signing), so Nest's normal urlencoded-parsed `req.body`
 * is the correct input, not `req.rawBody`.
 *
 * `url` must be the *exact* URL configured in the Twilio Console for this
 * webhook (protocol + host + path, no query string, no trailing slash) —
 * a mismatch here (e.g. http vs https, or a proxy-rewritten host) produces
 * a signature that will never match, indistinguishable from a forged
 * request. See TwilioWebhookController for how the URL is reconstructed
 * from the incoming request.
 *
 * Deliberately pure/side-effect-free (no throwing, no logging), same
 * contract as verifyMetaWebhookSignature — returns a plain boolean so the
 * controller decides what to log/respond, and stays trivially
 * unit-testable without an HTTP server.
 */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

/**
 * Uses `timingSafeEqual` (not `===`) for the same reason
 * verifyMetaWebhookSignature does — a byte-by-byte comparison must never
 * leak timing information about how much of a guessed signature matched.
 */
export function verifyTwilioWebhookSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) {
    return false;
  }

  const expected = computeTwilioSignature(authToken, url, params);

  const expectedBuffer = Buffer.from(expected, 'base64');
  const providedBuffer = Buffer.from(signatureHeader, 'base64');
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false — a malformed/truncated header must fail closed, not throw past
  // this function's own no-throw contract.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
