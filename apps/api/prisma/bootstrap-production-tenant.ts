/**
 * Website Launch Step 4: one-off production bootstrap for Trans Atlantic
 * (Tenant #1). Deliberately separate from seed.ts — that script is
 * dev-only (fixed, publicly-documented credentials, and a pile of sample
 * customers/shipments) and must never run against production. This
 * script creates exactly the two rows production needs to be usable at
 * all: the real Tenant, and one TENANT_OWNER login with a freshly
 * generated password that is never logged, printed, or returned by this
 * script — it's written straight to a caller-specified file path.
 *
 * Idempotent the same way seed.ts is: upsert on Tenant.slug and on
 * User's (tenantId, email) pair, so re-running this is harmless.
 *
 * Usage (against production, via a DATABASE_URL pointed at a tunnel —
 * never run with a shadow/local dev DATABASE_URL by accident):
 *   OWNER_PASSWORD_OUT=/path/to/scratch/file.env npx ts-node prisma/bootstrap-production-tenant.ts
 */
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const outPath = process.env.OWNER_PASSWORD_OUT;
  if (!outPath) {
    throw new Error('Set OWNER_PASSWORD_OUT to a file path the generated Owner password should be written to.');
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'transatlantic' },
    update: {},
    create: {
      name: 'Trans Atlantic Logistics Solutions',
      slug: 'transatlantic',
      legalName: 'Trans Atlantic Logistics Solutions LLC',
      email: 'info@talogisticssolutions.com',
      phone: '+1 (214) 493-7745',
      website: 'https://talogisticssolutions.com',
      country: 'United States',
      timezone: 'America/Chicago',
      currency: 'USD',
      isActive: true,
      settings: {
        create: {
          customerNumberPrefix: 'TA',
          trackingNumberPrefix: 'TAL',
          invoiceNumberPrefix: 'INV',
          defaultOriginCountry: 'United States',
          defaultDestinationCountry: 'Ghana',
        },
      },
    },
  });
  console.log(`Tenant ready: ${tenant.name} (${tenant.slug})`);

  const ownerEmail = 'info@talogisticssolutions.com';
  const existing = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: ownerEmail } });

  if (existing) {
    console.log(`Owner account already exists (${ownerEmail}) — not touching its password.`);
    return;
  }

  const password = randomBytes(18).toString('base64url'); // 24 chars, URL-safe
  const passwordHash = await bcrypt.hash(password, 10);

  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: ownerEmail,
      passwordHash,
      firstName: 'Trans Atlantic',
      lastName: 'Team',
      role: UserRole.TENANT_OWNER,
      isActive: true,
    },
  });

  fs.writeFileSync(outPath, `OWNER_EMAIL=${owner.email}\nOWNER_PASSWORD=${password}\n`, { mode: 0o600 });
  console.log(`Owner account created (${owner.email}). Password written to ${outPath} — never printed here.`);
}

main()
  .catch((err) => {
    console.error('Bootstrap failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
