import { PrismaClient } from '@prisma/client';

/**
 * Runs once, after every spec file has finished, in its own process —
 * the deterministic backstop for test-data cleanup. Per-file `afterAll`
 * hooks (see test/utils/fixtures.ts's deleteTestTenant) are the primary
 * cleanup path and now retry on transient failures instead of silently
 * swallowing them, but this global sweep guarantees the end state is
 * always zero `e2e-*` tenants regardless of any individual hook's outcome
 * — including a hook that never got to run at all (e.g. the process was
 * killed mid-suite). Only ever deletes tenants matching the `e2e-` slug
 * prefix every test fixture uses; the real seeded "transatlantic" tenant
 * is structurally impossible to match and is never touched.
 */
export default async function globalTeardown(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const { count } = await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'e2e-' } } });
    if (count > 0) {
      console.warn(`[global-teardown] Removed ${count} leftover e2e-* tenant(s) after the suite finished.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
