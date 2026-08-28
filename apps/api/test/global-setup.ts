import { PrismaClient } from '@prisma/client';

/**
 * Runs once, before any spec file, in its own process. Sweeps up any
 * `e2e-*` tenant left behind by a previous interrupted run (e.g. a
 * process killed mid-suite before its own afterAll could fire) so every
 * run starts from a guaranteed-clean slate — no cross-run contamination.
 * Matches only the `e2e-` slug prefix every test fixture uses
 * (see test/utils/fixtures.ts); the real seeded "transatlantic" tenant
 * never matches this filter and is never touched.
 */
export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const { count } = await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'e2e-' } } });
    if (count > 0) {
      console.warn(`[global-setup] Removed ${count} leftover e2e-* tenant(s) from a previous run.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
