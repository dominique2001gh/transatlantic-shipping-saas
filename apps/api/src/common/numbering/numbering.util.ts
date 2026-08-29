import type { PrismaClient } from '@prisma/client';
import { formatCustomerNumber, formatTrackingNumber } from '@transatlantic/shared';

/**
 * Tenant-scoped sequential number generation for customer numbers and
 * shipment tracking numbers. Uses Prisma's atomic `increment` so
 * concurrent requests never hand out the same number twice — the UPDATE
 * itself is atomic at the database level, no explicit lock needed.
 *
 * Stored TenantSettings sequence values represent "count issued so far",
 * not "next number to use": the first number ever issued is sequence
 * value 1, produced by incrementing from the column's default of 0.
 *
 * Plain functions (not a NestJS-injectable service) so prisma/seed.ts —
 * which runs outside Nest's DI container — can call the exact same logic
 * the real API uses, rather than duplicating it.
 */

export async function generateCustomerNumber(prisma: PrismaClient, tenantId: string): Promise<string> {
  const settings = await prisma.tenantSettings.update({
    where: { tenantId },
    data: { customerNumberSequence: { increment: 1 } },
    select: { customerNumberPrefix: true, customerNumberSequence: true },
  });
  return formatCustomerNumber(settings.customerNumberPrefix, settings.customerNumberSequence);
}

export async function generateTrackingNumber(prisma: PrismaClient, tenantId: string): Promise<string> {
  const settings = await prisma.tenantSettings.update({
    where: { tenantId },
    data: { trackingNumberSequence: { increment: 1 } },
    select: { trackingNumberPrefix: true, trackingNumberSequence: true },
  });
  return formatTrackingNumber(
    settings.trackingNumberPrefix,
    new Date().getFullYear(),
    settings.trackingNumberSequence,
  );
}

/**
 * A manifest number is an internal reference (unlike containerNumber,
 * which is staff-entered because real ISO container numbers are assigned
 * externally by the shipping line) — the same prefix+year+sequence shape
 * as trackingNumber suits it, so this reuses formatTrackingNumber's
 * formatter rather than inventing a parallel one.
 */
export async function generateManifestNumber(prisma: PrismaClient, tenantId: string): Promise<string> {
  const settings = await prisma.tenantSettings.update({
    where: { tenantId },
    data: { manifestNumberSequence: { increment: 1 } },
    select: { manifestNumberPrefix: true, manifestNumberSequence: true },
  });
  return formatTrackingNumber(
    settings.manifestNumberPrefix,
    new Date().getFullYear(),
    settings.manifestNumberSequence,
  );
}
