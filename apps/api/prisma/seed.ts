/**
 * Development seed data.
 *
 * Run with `pnpm prisma:seed` (or automatically after `prisma migrate dev`).
 * Never run against a production database — this uses fixed, publicly
 * documented dev credentials (see README.md).
 */
import { PrismaClient, UserRole, ShipmentMode, ShipmentStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { formatCustomerNumber, formatTrackingNumber } from '@transatlantic/shared';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'Password123!';

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

async function main() {
  console.log('Seeding development data...');

  // --------------------------------------------------------------------
  // Tenant #1: Trans Atlantic Logistics Solutions
  // --------------------------------------------------------------------
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'transatlantic' },
    update: {},
    create: {
      name: 'Trans Atlantic Logistics Solutions',
      slug: 'transatlantic',
      legalName: 'Trans Atlantic Logistics Solutions LLC',
      email: 'info@talogisticssolutions.com',
      phone: '+1-555-010-0100',
      website: 'https://talogisticssolutions.com',
      country: 'United States',
      timezone: 'America/Chicago',
      currency: 'USD',
      isActive: true,
      settings: {
        create: {
          customerNumberPrefix: 'TA',
          customerNumberSequence: 1,
          trackingNumberPrefix: 'TAL',
          trackingNumberSequence: 1,
          invoiceNumberPrefix: 'INV',
          invoiceNumberSequence: 0,
          defaultOriginCountry: 'United States',
          defaultDestinationCountry: 'Ghana',
        },
      },
    },
    include: { settings: true },
  });
  console.log(`  Tenant: ${tenant.name} (${tenant.slug})`);

  // --------------------------------------------------------------------
  // Platform admin (Ananse) — no tenantId, manages all tenants
  // --------------------------------------------------------------------
  const platformAdminPasswordHash = await hashPassword(DEV_PASSWORD);
  const platformAdmin = await prisma.user.upsert({
    where: { email: 'platformadmin@ananse.dev' },
    update: {},
    create: {
      email: 'platformadmin@ananse.dev',
      passwordHash: platformAdminPasswordHash,
      firstName: 'Ananse',
      lastName: 'Admin',
      role: UserRole.PLATFORM_ADMIN,
      tenantId: null,
      isActive: true,
    },
  });
  console.log(`  Platform admin: ${platformAdmin.email}`);

  // --------------------------------------------------------------------
  // Tenant admin
  // --------------------------------------------------------------------
  const tenantAdmin = await prisma.user.upsert({
    where: { email: 'admin@transatlantic.dev' },
    update: {},
    create: {
      email: 'admin@transatlantic.dev',
      passwordHash: await hashPassword(DEV_PASSWORD),
      firstName: 'Akosua',
      lastName: 'Mensah',
      role: UserRole.TENANT_ADMIN,
      tenantId: tenant.id,
      isActive: true,
    },
  });
  console.log(`  Tenant admin: ${tenantAdmin.email}`);

  // --------------------------------------------------------------------
  // Warehouse staff
  // --------------------------------------------------------------------
  const warehouseStaff = await prisma.user.upsert({
    where: { email: 'warehouse@transatlantic.dev' },
    update: {},
    create: {
      email: 'warehouse@transatlantic.dev',
      passwordHash: await hashPassword(DEV_PASSWORD),
      firstName: 'Kwame',
      lastName: 'Owusu',
      role: UserRole.WAREHOUSE_STAFF,
      tenantId: tenant.id,
      isActive: true,
    },
  });
  console.log(`  Warehouse staff: ${warehouseStaff.email}`);

  // --------------------------------------------------------------------
  // Sample warehouse (origin, Texas)
  // --------------------------------------------------------------------
  const warehouse = await prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'TX-01' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Houston Origin Warehouse',
      code: 'TX-01',
      addressLine1: '4200 Freight Way',
      city: 'Houston',
      state: 'TX',
      country: 'United States',
      postalCode: '77001',
      phone: '+1-555-010-0200',
      isOriginWarehouse: true,
      isDestinationWarehouse: false,
      isActive: true,
    },
  });
  console.log(`  Warehouse: ${warehouse.name} (${warehouse.code})`);

  // --------------------------------------------------------------------
  // Sample customer (with a portal login)
  // --------------------------------------------------------------------
  const customerUser = await prisma.user.upsert({
    where: { email: 'customer@transatlantic.dev' },
    update: {},
    create: {
      email: 'customer@transatlantic.dev',
      passwordHash: await hashPassword(DEV_PASSWORD),
      firstName: 'Ama',
      lastName: 'Boateng',
      role: UserRole.CUSTOMER,
      tenantId: tenant.id,
      isActive: true,
    },
  });

  const customerNumber = formatCustomerNumber(
    tenant.settings!.customerNumberPrefix,
    tenant.settings!.customerNumberSequence,
  );

  const customer = await prisma.customer.upsert({
    where: { tenantId_customerNumber: { tenantId: tenant.id, customerNumber } },
    update: {},
    create: {
      tenantId: tenant.id,
      customerNumber,
      firstName: 'Ama',
      lastName: 'Boateng',
      email: 'customer@transatlantic.dev',
      phone: '+1-555-010-0300',
      userId: customerUser.id,
      addresses: {
        create: [
          {
            tenantId: tenant.id,
            type: 'BILLING',
            label: 'Home',
            line1: '18 Palm Street',
            city: 'Houston',
            state: 'TX',
            postalCode: '77002',
            country: 'United States',
            isDefault: true,
          },
          {
            tenantId: tenant.id,
            type: 'DESTINATION',
            label: 'Accra delivery address',
            line1: '12 Ring Road East',
            city: 'Accra',
            country: 'Ghana',
            isDefault: false,
          },
        ],
      },
    },
  });
  await prisma.tenantSettings.update({
    where: { tenantId: tenant.id },
    data: { customerNumberSequence: tenant.settings!.customerNumberSequence + 1 },
  });
  console.log(`  Customer: ${customer.firstName} ${customer.lastName} (${customer.customerNumber})`);

  // --------------------------------------------------------------------
  // Sample Ghana-bound shipment with a tracking history
  // --------------------------------------------------------------------
  const trackingNumber = formatTrackingNumber(
    tenant.settings!.trackingNumberPrefix,
    new Date().getFullYear(),
    tenant.settings!.trackingNumberSequence,
  );

  const existingShipment = await prisma.shipment.findUnique({ where: { trackingNumber } });
  const shipment =
    existingShipment ??
    (await prisma.shipment.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        trackingNumber,
        shipmentMode: ShipmentMode.OCEAN_LCL,
        originCountry: 'United States',
        destinationCountry: 'Ghana',
        originLocation: 'Houston, TX',
        destinationLocation: 'Tema, Ghana',
        originWarehouseId: warehouse.id,
        status: ShipmentStatus.WAREHOUSE_RECEIVED,
        description: 'Household goods barrel + 1 box of electronics',
        declaredValue: 850,
        currency: 'USD',
        items: {
          create: [
            {
              tenantId: tenant.id,
              itemType: 'BARREL',
              description: 'Household goods',
              quantity: 1,
              weight: 180,
              weightUnit: 'LB',
              declaredValue: 600,
            },
            {
              tenantId: tenant.id,
              itemType: 'BOX',
              description: 'Electronics',
              quantity: 1,
              weight: 35,
              weightUnit: 'LB',
              declaredValue: 250,
            },
          ],
        },
        trackingEvents: {
          create: [
            {
              tenantId: tenant.id,
              status: ShipmentStatus.DRAFT,
              notes: 'Shipment created',
              occurredAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
            },
            {
              tenantId: tenant.id,
              status: ShipmentStatus.AWAITING_ITEMS,
              location: 'Houston, TX',
              occurredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
            },
            {
              tenantId: tenant.id,
              status: ShipmentStatus.WAREHOUSE_RECEIVED,
              location: 'Houston Origin Warehouse',
              notes: 'All items received and inspected',
              occurredAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
            },
          ],
        },
      },
    }));
  if (!existingShipment) {
    await prisma.tenantSettings.update({
      where: { tenantId: tenant.id },
      data: { trackingNumberSequence: tenant.settings!.trackingNumberSequence + 1 },
    });
  }
  console.log(`  Shipment: ${shipment.trackingNumber} -> ${shipment.destinationCountry}`);

  console.log('\nSeed complete. Development login credentials are documented in README.md.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
