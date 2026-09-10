/**
 * One-off production seed: the three real AnanseLogix SaaS plans approved
 * for launch (Website Only, Basic, Professional). SOFTWARE_ONLY and the
 * legacy WEBSITE_AND_SOFTWARE key are deliberately not touched — retired
 * from public sale (see SaasPlanType's own doc comment in schema.prisma).
 *
 * Deliberately separate from seed.ts (dev-only, fixed sample data) and
 * from bootstrap-production-tenant.ts (Trans Atlantic tenant/owner). This
 * script only ever touches the saas_plans / saas_plan_prices tables.
 *
 * Idempotent, safe to re-run:
 *   - SaasPlan: upserted on its unique `key`. `update: {}` — an existing
 *     row (e.g. later hand-edited via /platform/plans) is never
 *     overwritten by re-running this script.
 *   - SaasPlanPrice: there is no unique DB constraint on (planId,
 *     interval) — exactly-one-active-per-interval is a service-layer rule
 *     (see SaasPlansService), not enforced here. So before creating a
 *     price this script checks for an existing active MONTH price for
 *     that plan and skips creation if one is already there, rather than
 *     ever creating a second active row.
 *
 * Usage (against production, via a private tunnel — never a local/shadow
 * DATABASE_URL by accident):
 *   DATABASE_URL=postgresql://... npx ts-node prisma/seed-ananselogix-plans.ts
 */
import { PrismaClient, SaasPlanType } from '@prisma/client';

const prisma = new PrismaClient();

const PLANS: Array<{
  key: SaasPlanType;
  name: string;
  setupFeeCents: number;
  monthlyAmountCents: number;
  trialDays: number;
}> = [
  { key: SaasPlanType.WEBSITE_ONLY, name: 'Website Only', setupFeeCents: 75000, monthlyAmountCents: 5900, trialDays: 0 },
  { key: SaasPlanType.SOFTWARE_AND_WEBSITE_BASIC, name: 'Basic', setupFeeCents: 35000, monthlyAmountCents: 14900, trialDays: 0 },
  { key: SaasPlanType.SOFTWARE_AND_WEBSITE_PROFESSIONAL, name: 'Professional', setupFeeCents: 35000, monthlyAmountCents: 24900, trialDays: 0 },
];

async function main() {
  console.log('Seeding AnanseLogix SaaS plans (production)...\n');

  for (const spec of PLANS) {
    const plan = await prisma.saasPlan.upsert({
      where: { key: spec.key },
      update: {},
      create: {
        key: spec.key,
        name: spec.name,
        description: null,
        isActive: true,
      },
    });
    console.log(`  Plan: ${plan.key} -> "${plan.name}" (id ${plan.id}, isActive ${plan.isActive})`);

    const existingActivePrice = await prisma.saasPlanPrice.findFirst({
      where: { planId: plan.id, interval: 'MONTH', isActive: true },
    });

    if (existingActivePrice) {
      console.log(
        `    Price: already has an active MONTH price (id ${existingActivePrice.id}, ` +
          `setup $${existingActivePrice.setupFeeCents / 100}, monthly $${existingActivePrice.monthlyAmountCents / 100}) — skipping, not creating a duplicate.`,
      );
      continue;
    }

    const price = await prisma.saasPlanPrice.create({
      data: {
        planId: plan.id,
        interval: 'MONTH',
        currency: 'usd',
        setupFeeCents: spec.setupFeeCents,
        monthlyAmountCents: spec.monthlyAmountCents,
        trialDays: spec.trialDays,
        isActive: true,
      },
    });
    console.log(
      `    Price: created (id ${price.id}) — setup $${price.setupFeeCents / 100}, ` +
        `monthly $${price.monthlyAmountCents / 100}/${price.interval}, trialDays ${price.trialDays}`,
    );
  }

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
