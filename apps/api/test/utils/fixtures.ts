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

/** Deletes a test tenant and (via cascade) everything created under it. */
export async function deleteTestTenant(prisma: PrismaClient, tenantId: string): Promise<void> {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
}
