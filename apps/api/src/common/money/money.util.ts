import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Stage 3A: normalizes a Prisma Decimal to a fixed 2-decimal-place string
 * for API responses.
 *
 * Prisma's Decimal already serializes to JSON as a string whenever one
 * reaches JSON.stringify (its toJSON() delegates to decimal.js's
 * toString()) — but that string is variable-precision, e.g.
 * `new Prisma.Decimal('1234.50').toJSON()` is `"1234.5"`, not `"1234.50"`.
 * Every money field this API returns must go through this instead, so the
 * frontend/API boundary has exactly one predictable shape to rely on
 * rather than rediscovering this per field. Never converts to a JS number
 * (float) — `.toFixed(2)` is decimal.js's own string formatting, so full
 * database precision is preserved right up to the point of display
 * formatting; no floating-point arithmetic is involved.
 */
export function formatMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

/**
 * Stage 3C: the largest value every money column (`Decimal(12, 2)`) can
 * actually hold — 10 digits before the decimal point, 2 after.
 */
export const MAX_MONEY_VALUE = new Prisma.Decimal('9999999999.99');

/**
 * Stage 3C hardening: without this, a computed subtotal/tax/total that
 * exceeds Decimal(12,2)'s column precision would fail at the Postgres
 * INSERT itself (a raw numeric-field-overflow error), surfacing as an
 * unhandled 500 instead of a clean validation failure. decimal.js has no
 * such ceiling on its own — arithmetic on an absurd input (e.g. a
 * unitPrice of 1e20) succeeds happily in JS memory right up until the
 * database rejects it. Call this on every computed total before it ever
 * reaches a Prisma write.
 */
export function assertWithinMoneyRange(value: Prisma.Decimal, fieldLabel: string): void {
  if (value.greaterThan(MAX_MONEY_VALUE)) {
    throw new BadRequestException(`${fieldLabel} is too large`);
  }
}
