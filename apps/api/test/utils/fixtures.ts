import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

/**
 * Ephemeral test-fixture helpers for multi-tenant e2e tests. Every fixture
 * created here is a fresh Tenant (never the real seeded "transatlantic"
 * tenant), so tests can freely create/mutate/delete data without touching
 * anything a developer is looking at in the seeded dev environment.
 *
 * `deleteTestTenant` relies on `onDelete: Cascade` from Tenant to every
 * child table (see schema.prisma) to clean up everything in one call.
 */

export const TEST_PASSWORD = 'TestPass123!';

export interface TestTenantFixture {
  tenantId: string;
  slug: string;
  warehouseId: string;
  customerId: string;
  user: { id: string; email: string; password: string };
}

/**
 * Creates a fully isolated tenant (with settings, one staff user, one
 * warehouse, and one customer) ready to drive shipment/warehouse
 * workflows through the real HTTP API. `trackingNumberPrefix` defaults to
 * the same value across fixtures on purpose — two independently-created
 * test tenants issuing their first shipment both land on
 * "E2E-<year>-000001", which is exactly the same-tracking-number-two-
 * tenants scenario these tests exist to prove is safe.
 */
export async function createTestTenant(
  prisma: PrismaClient,
  label: string,
  role: UserRole = UserRole.WAREHOUSE_MANAGER,
): Promise<TestTenantFixture> {
  const runId = randomUUID().slice(0, 8);
  const slug = `e2e-${label}-${runId}`.toLowerCase();

  const tenant = await prisma.tenant.create({
    data: {
      name: `E2E Test Tenant ${label} ${runId}`,
      slug,
      email: `tenant-${runId}@example.test`,
      country: 'US',
      timezone: 'America/Chicago',
      currency: 'USD',
      settings: {
        create: {
          trackingNumberPrefix: 'E2E',
          customerNumberPrefix: 'E2E',
        },
      },
    },
  });

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `staff-${runId}@example.test`,
      passwordHash,
      firstName: 'E2E',
      lastName: label,
      role,
    },
  });

  const warehouse = await prisma.warehouse.create({
    data: {
      tenantId: tenant.id,
      name: `${label} Test Warehouse`,
      code: `E2E-${runId}`,
      addressLine1: '1 Test Street',
      city: 'Testville',
      country: 'US',
      isOriginWarehouse: true,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      customerNumber: `E2E-${runId}`,
      firstName: 'Test',
      lastName: 'Customer',
      email: `customer-${runId}@example.test`,
    },
  });

  return {
    tenantId: tenant.id,
    slug,
    warehouseId: warehouse.id,
    customerId: customer.id,
    user: { id: user.id, email: user.email, password: TEST_PASSWORD },
  };
}

/**
 * Deletes a test tenant and (via cascade) everything created under it.
 * Retries on transient failures (e.g. brief connection-pool pressure when
 * many e2e spec files run back-to-back in the same process) instead of
 * silently swallowing every error — a real, non-transient failure here
 * must be visible, not hidden, since it means ephemeral test data would
 * otherwise leak into the shared dev database. `test/global-teardown.ts`
 * is the deterministic backstop: even if this throws (e.g. the process
 * is killed before this ever runs), the global teardown sweeps up any
 * `e2e-*` tenant left behind after the full suite finishes.
 */
export async function deleteTestTenant(prisma: PrismaClient, tenantId: string): Promise<void> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await prisma.tenant.delete({ where: { id: tenantId } });
      return;
    } catch (error) {
      lastError = error;
      // "Record not found" (P2025) means it's already gone — not an error.
      if ((error as { code?: string }).code === 'P2025') {
        return;
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      }
    }
  }
  console.error(`deleteTestTenant: failed to delete tenant ${tenantId} after ${MAX_ATTEMPTS} attempts.`, lastError);
  throw lastError;
}

/** Adds one more user of an arbitrary role to an already-created test tenant — e.g. for RBAC checks. */
export async function createUserInTenant(
  prisma: PrismaClient,
  tenantId: string,
  label: string,
  role: UserRole,
): Promise<{ id: string; email: string; password: string }> {
  const runId = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${label.toLowerCase()}-${runId}@example.test`,
      passwordHash,
      firstName: 'E2E',
      lastName: label,
      role,
    },
  });
  return { id: user.id, email: user.email, password: TEST_PASSWORD };
}

export interface TestPortalCustomerFixture {
  customerId: string;
  user: { id: string; email: string; password: string };
}

/**
 * Stage 2C: creates a Customer *with* a linked portal-login User (role
 * CUSTOMER, Customer.userId set) — the "Customer #1 (with a portal login)"
 * shape from apps/api/prisma/seed.ts, as an isolated e2e fixture rather
 * than the real seeded tenant. Use this (not `createTestTenant`'s own
 * customer, which has no linked user) whenever a test needs to log in as a
 * customer.
 */
export async function createCustomerWithPortalUser(
  prisma: PrismaClient,
  tenantId: string,
  label: string,
): Promise<TestPortalCustomerFixture> {
  const runId = randomUUID().slice(0, 8);
  const email = `portal-${label.toLowerCase()}-${runId}@example.test`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  const user = await prisma.user.create({
    data: {
      tenantId,
      email,
      passwordHash,
      firstName: 'E2E',
      lastName: label,
      role: UserRole.CUSTOMER,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      tenantId,
      customerNumber: `E2E-PORTAL-${runId}`,
      firstName: 'E2E',
      lastName: label,
      email,
      userId: user.id,
    },
  });

  return { customerId: customer.id, user: { id: user.id, email, password: TEST_PASSWORD } };
}

/**
 * Stage 2C: a CUSTOMER-role User deliberately created with NO linked
 * Customer record — the "should never happen given the schema, but fail
 * closed if it does" edge case CustomerPortalService.getProfile and
 * requireCustomerId() both guard against. Exists purely to drive that
 * failure path in a test.
 */
export async function createOrphanedCustomerUser(
  prisma: PrismaClient,
  tenantId: string,
  label: string,
): Promise<{ id: string; email: string; password: string }> {
  return createUserInTenant(prisma, tenantId, label, UserRole.CUSTOMER);
}
