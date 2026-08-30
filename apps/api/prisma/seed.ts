/**
 * Development seed data.
 *
 * Run with `pnpm prisma:seed` (or automatically after `prisma migrate dev`).
 * Never run against a production database — this uses fixed, publicly
 * documented dev credentials (see README.md).
 *
 * Idempotent: every record is guarded by a lookup on a value that stays
 * stable across re-runs (email, tenantId+code, customerId) *before*
 * generating a sequential number — customerNumber/trackingNumber
 * generation increments TenantSettings' counters, so it must only ever
 * run once per record, not be re-derived on every seed run.
 */
import {
  PrismaClient,
  ShipmentItemStatus,
  ShipmentItemType,
  ShipmentMode,
  ShipmentStatus,
  TrackingEventSource,
  TrackingEventType,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { formatItemCode } from '@transatlantic/shared';
import { generateCustomerNumber, generateTrackingNumber } from '../src/common/numbering/numbering.util';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'Password123!';
const DAY_MS = 24 * 60 * 60 * 1000;

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
          trackingNumberPrefix: 'TAL',
          invoiceNumberPrefix: 'INV',
          defaultOriginCountry: 'United States',
          defaultDestinationCountry: 'Ghana',
        },
      },
    },
  });
  console.log(`  Tenant: ${tenant.name} (${tenant.slug})`);

  // --------------------------------------------------------------------
  // Staff users
  // --------------------------------------------------------------------
  const platformAdmin = await prisma.user.upsert({
    where: { email: 'platformadmin@ananse.dev' },
    update: {},
    create: {
      email: 'platformadmin@ananse.dev',
      passwordHash: await hashPassword(DEV_PASSWORD),
      firstName: 'Ananse',
      lastName: 'Admin',
      role: UserRole.PLATFORM_ADMIN,
      tenantId: null,
      isActive: true,
    },
  });
  console.log(`  Platform admin: ${platformAdmin.email}`);

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

  const warehouseManager = await prisma.user.upsert({
    where: { email: 'warehouse.manager@transatlantic.dev' },
    update: {},
    create: {
      email: 'warehouse.manager@transatlantic.dev',
      passwordHash: await hashPassword(DEV_PASSWORD),
      firstName: 'Efua',
      lastName: 'Asiedu',
      role: UserRole.WAREHOUSE_MANAGER,
      tenantId: tenant.id,
      isActive: true,
    },
  });
  console.log(`  Warehouse manager: ${warehouseManager.email}`);

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
  // Sample warehouse (origin, Dallas–Fort Worth, Texas)
  // --------------------------------------------------------------------
  const warehouse = await prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'TX-01' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'DFW Origin Warehouse',
      code: 'TX-01',
      addressLine1: '4200 Freight Way',
      city: 'Dallas-Fort Worth',
      state: 'TX',
      country: 'United States',
      postalCode: '75261',
      phone: '+1-555-010-0200',
      isOriginWarehouse: true,
      isDestinationWarehouse: false,
      isActive: true,
    },
  });
  console.log(`  Warehouse: ${warehouse.name} (${warehouse.code})`);

  // Destination warehouse — gives the warehouse selector something real
  // to switch between and matches the schema's own "Accra/Tema" example.
  const destinationWarehouse = await prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'GH-01' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Accra Destination Warehouse',
      code: 'GH-01',
      addressLine1: '12 Spintex Road',
      city: 'Accra',
      country: 'Ghana',
      phone: '+233-30-555-0100',
      isOriginWarehouse: false,
      isDestinationWarehouse: true,
      isActive: true,
    },
  });
  console.log(`  Warehouse: ${destinationWarehouse.name} (${destinationWarehouse.code})`);

  // --------------------------------------------------------------------
  // Customer #1 (with a portal login) — partial-receipt scenario:
  // one item received, one still awaiting drop-off. Demonstrates that
  // ShipmentItem.status and Shipment.status move independently.
  // --------------------------------------------------------------------
  const customer1User = await prisma.user.upsert({
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

  let customer1 = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, email: 'customer@transatlantic.dev' },
  });
  if (!customer1) {
    const customerNumber = await generateCustomerNumber(prisma, tenant.id);
    customer1 = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        customerNumber,
        firstName: 'Ama',
        lastName: 'Boateng',
        email: 'customer@transatlantic.dev',
        phone: '+1-555-010-0300',
        userId: customer1User.id,
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
  }
  console.log(`  Customer: ${customer1.firstName} ${customer1.lastName} (${customer1.customerNumber})`);

  const existingShipment1 = await prisma.shipment.findFirst({
    where: { tenantId: tenant.id, customerId: customer1.id },
  });
  if (!existingShipment1) {
    const trackingNumber = await generateTrackingNumber(prisma, tenant.id);
    const shipment1 = await prisma.shipment.create({
      data: {
        tenantId: tenant.id,
        customerId: customer1.id,
        trackingNumber,
        shipmentMode: ShipmentMode.OCEAN_LCL,
        originCountry: 'United States',
        destinationCountry: 'Ghana',
        originLocation: 'DFW, TX',
        destinationLocation: 'Tema Harbour, Ghana',
        originWarehouseId: warehouse.id,
        status: ShipmentStatus.AWAITING_ITEMS,
        description: 'Household goods barrel + 1 box of electronics',
        declaredValue: 850,
        currency: 'USD',
      },
    });

    const createdAt3d = new Date(Date.now() - 3 * DAY_MS);
    const createdAt4d = new Date(Date.now() - 4 * DAY_MS);
    const receivedAt1d = new Date(Date.now() - 1 * DAY_MS);

    await prisma.trackingEvent.create({
      data: {
        tenantId: tenant.id,
        shipmentId: shipment1.id,
        eventType: TrackingEventType.SHIPMENT_CREATED,
        source: TrackingEventSource.SYSTEM,
        status: ShipmentStatus.DRAFT,
        occurredAt: createdAt4d,
      },
    });
    await prisma.trackingEvent.create({
      data: {
        tenantId: tenant.id,
        shipmentId: shipment1.id,
        eventType: TrackingEventType.NOTE_ADDED,
        source: TrackingEventSource.SYSTEM,
        status: ShipmentStatus.AWAITING_ITEMS,
        notes: 'Awaiting customer drop-off at origin warehouse',
        occurredAt: createdAt3d,
      },
    });

    // Item 1: barrel — received.
    const barrel = await prisma.shipmentItem.create({
      data: {
        tenantId: tenant.id,
        shipmentId: shipment1.id,
        itemCode: formatItemCode(trackingNumber, 1),
        sequenceNumber: 1,
        itemType: ShipmentItemType.BARREL,
        status: ShipmentItemStatus.RECEIVED_ORIGIN_WAREHOUSE,
        description: 'Household goods',
        quantity: 1,
        weight: 180,
        weightUnit: 'LB',
        declaredValue: 600,
        currentWarehouseId: warehouse.id,
        receivedAt: receivedAt1d,
        receivedByUserId: warehouseStaff.id,
      },
    });
    await prisma.trackingEvent.create({
      data: {
        tenantId: tenant.id,
        shipmentId: shipment1.id,
        shipmentItemId: barrel.id,
        eventType: TrackingEventType.ITEM_REGISTERED,
        source: TrackingEventSource.SYSTEM,
        occurredAt: createdAt3d,
      },
    });
    await prisma.trackingEvent.create({
      data: {
        tenantId: tenant.id,
        shipmentId: shipment1.id,
        shipmentItemId: barrel.id,
        eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE,
        source: TrackingEventSource.MANUAL,
        warehouseId: warehouse.id,
        notes: 'Received and inspected at origin warehouse',
        createdByUserId: warehouseStaff.id,
        occurredAt: receivedAt1d,
      },
    });

    // Item 2: box — registered, not yet physically received.
    const box = await prisma.shipmentItem.create({
      data: {
        tenantId: tenant.id,
        shipmentId: shipment1.id,
        itemCode: formatItemCode(trackingNumber, 2),
        sequenceNumber: 2,
        itemType: ShipmentItemType.BOX,
        status: ShipmentItemStatus.REGISTERED,
        description: 'Electronics',
        quantity: 1,
        weight: 35,
        weightUnit: 'LB',
        declaredValue: 250,
      },
    });
    await prisma.trackingEvent.create({
      data: {
        tenantId: tenant.id,
        shipmentId: shipment1.id,
        shipmentItemId: box.id,
        eventType: TrackingEventType.ITEM_REGISTERED,
        source: TrackingEventSource.SYSTEM,
        occurredAt: createdAt3d,
      },
    });

    console.log(`  Shipment: ${shipment1.trackingNumber} -> ${shipment1.destinationCountry} (1 of 2 items received)`);
  }

  // --------------------------------------------------------------------
  // Customer #2 (staff-created profile, no portal login yet) —
  // full-receipt scenario, different destination market and mode to
  // demonstrate this is not a Ghana-only / ocean-only system.
  // --------------------------------------------------------------------
  let customer2 = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, email: 'kofi.asante@example.com' },
  });
  if (!customer2) {
    const customerNumber = await generateCustomerNumber(prisma, tenant.id);
    customer2 = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        customerNumber,
        firstName: 'Kofi',
        lastName: 'Asante',
        email: 'kofi.asante@example.com',
        phone: '+1-555-010-0400',
        addresses: {
          create: [
            {
              tenantId: tenant.id,
              type: 'DESTINATION',
              label: 'Lagos delivery address',
              line1: '4 Adeola Odeku Street',
              city: 'Lagos',
              country: 'Nigeria',
              isDefault: true,
            },
          ],
        },
      },
    });
  }
  console.log(`  Customer: ${customer2.firstName} ${customer2.lastName} (${customer2.customerNumber})`);

  const existingShipment2 = await prisma.shipment.findFirst({
    where: { tenantId: tenant.id, customerId: customer2.id },
  });
  if (!existingShipment2) {
    const trackingNumber = await generateTrackingNumber(prisma, tenant.id);
    const shipment2 = await prisma.shipment.create({
      data: {
        tenantId: tenant.id,
        customerId: customer2.id,
        trackingNumber,
        shipmentMode: ShipmentMode.AIR,
        originCountry: 'United States',
        destinationCountry: 'Nigeria',
        originLocation: 'DFW, TX',
        destinationLocation: 'Lagos, Nigeria',
        originWarehouseId: warehouse.id,
        status: ShipmentStatus.WAREHOUSE_RECEIVED,
        description: 'Commercial electronics shipment — 3 items',
        declaredValue: 2400,
        currency: 'USD',
      },
    });

    const createdAt2d = new Date(Date.now() - 2 * DAY_MS);
    const receivedAt6h = new Date(Date.now() - 6 * 60 * 60 * 1000);

    await prisma.trackingEvent.create({
      data: {
        tenantId: tenant.id,
        shipmentId: shipment2.id,
        eventType: TrackingEventType.SHIPMENT_CREATED,
        source: TrackingEventSource.SYSTEM,
        status: ShipmentStatus.DRAFT,
        occurredAt: createdAt2d,
      },
    });

    const itemSpecs = [
      { type: ShipmentItemType.BOX, description: 'Laptops (4 units)', weight: 22, declaredValue: 1200 },
      { type: ShipmentItemType.BOX, description: 'Phone accessories', weight: 8, declaredValue: 400 },
      { type: ShipmentItemType.MACHINERY, description: 'Commercial sewing machine', weight: 65, declaredValue: 800 },
    ];

    for (const [index, spec] of itemSpecs.entries()) {
      const sequenceNumber = index + 1;
      const item = await prisma.shipmentItem.create({
        data: {
          tenantId: tenant.id,
          shipmentId: shipment2.id,
          itemCode: formatItemCode(trackingNumber, sequenceNumber),
          sequenceNumber,
          itemType: spec.type,
          status: ShipmentItemStatus.RECEIVED_ORIGIN_WAREHOUSE,
          description: spec.description,
          quantity: 1,
          weight: spec.weight,
          weightUnit: 'LB',
          declaredValue: spec.declaredValue,
          currentWarehouseId: warehouse.id,
          receivedAt: receivedAt6h,
          receivedByUserId: warehouseStaff.id,
        },
      });
      await prisma.trackingEvent.create({
        data: {
          tenantId: tenant.id,
          shipmentId: shipment2.id,
          shipmentItemId: item.id,
          eventType: TrackingEventType.ITEM_REGISTERED,
          source: TrackingEventSource.SYSTEM,
          occurredAt: createdAt2d,
        },
      });
      await prisma.trackingEvent.create({
        data: {
          tenantId: tenant.id,
          shipmentId: shipment2.id,
          shipmentItemId: item.id,
          eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE,
          source: TrackingEventSource.MANUAL,
          warehouseId: warehouse.id,
          createdByUserId: warehouseStaff.id,
          occurredAt: receivedAt6h,
        },
      });
    }

    // All 3 items are in — a shipment-level summary event reflects that
    // in Shipment.status, distinct from the item-level events above.
    await prisma.trackingEvent.create({
      data: {
        tenantId: tenant.id,
        shipmentId: shipment2.id,
        eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE,
        source: TrackingEventSource.SYSTEM,
        status: ShipmentStatus.WAREHOUSE_RECEIVED,
        notes: 'All items received at origin warehouse',
        occurredAt: receivedAt6h,
      },
    });

    console.log(`  Shipment: ${shipment2.trackingNumber} -> ${shipment2.destinationCountry} (3 of 3 items received)`);
  }

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
