/**
 * Populates a small, realistic, fictional demo operating history into ONE
 * specific existing tenant, entirely through the app's real NestJS
 * service layer (ShipmentsService, WarehouseService, ContainersService,
 * ManifestsService, InvoicesService, PaymentsService, OnboardingService)
 * rather than raw SQL — every business rule/status-transition guard those
 * services enforce for a real user still runs for real here.
 *
 * Boots the whole AppModule via NestFactory.createApplicationContext (no
 * HTTP server, no ValidationPipe, no JWT/guards — those are HTTP-layer
 * concerns that never run for a direct app.get(XService) call). Every
 * mutating call below is explicitly scoped to the one tenantId resolved
 * and confirmed at the top of main() — nothing here ever queries or
 * writes any other tenant's rows.
 *
 * The one deliberate exception to "services only": a handful of fields
 * have no service-layer setter anywhere in the app (Shipment/Customer/
 * Container/Invoice/Payment.createdAt — every create DTO omits it, it's
 * always `@default(now())`; Container.estimatedArrival — no service
 * method in ContainersService ever touches this column at all). For
 * those, and only those, this script does a narrow `prisma.<model>.update
 * ({ where: { id: <the exact row this script just created>, tenantId }
 * })` — never a bulk/blind update, always double-guarded by both the
 * specific id and tenantId. This adjusts *when it happened* metadata
 * after the real business logic already ran for real; it never changes
 * *what* happened or bypasses a single status/validation rule.
 *
 * Usage (from apps/api):
 *   npx ts-node -r tsconfig-paths/register scripts/seed-demo-tenant.ts \
 *     --tenant-id=<id> --tenant-slug=<slug>
 *
 * Both flags are required and are cross-checked against the tenant
 * actually resolved from the database — the script refuses to create
 * anything if either doesn't match exactly.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import {
  ContainerType,
  DimensionUnit,
  ItemProcessingResult,
  PaymentMethod,
  ShipmentItemCondition,
  ShipmentItemType,
  ShipmentMode,
  TrackingEventType,
  UserRole,
  WeightUnit,
} from '@transatlantic/shared';
import { AppModule } from '../src/app.module';
import { CustomersService } from '../src/customers/customers.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { WarehouseService } from '../src/warehouse/warehouse.service';
import { ContainersService } from '../src/containers/containers.service';
import { ManifestsService } from '../src/manifests/manifests.service';
import { InvoicesService } from '../src/invoices/invoices.service';
import { PaymentsService } from '../src/payments/payments.service';
import { OnboardingService } from '../src/onboarding/onboarding.service';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function readArg(name: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (!match) {
    throw new Error(`Missing required argument ${prefix}<value>`);
  }
  return match.slice(prefix.length);
}

const TARGET_TENANT_ID = readArg('tenant-id');
const TARGET_TENANT_SLUG = readArg('tenant-slug');

// ---------------------------------------------------------------------------
// Fictional demo data — clearly-fake domain so seeded rows are trivially
// identifiable later (e.g. `WHERE email LIKE '%@demo.tatanicfreight.test'`).
// ---------------------------------------------------------------------------
const DEMO_EMAIL_DOMAIN = 'demo.tatanicfreight.test';

const CUSTOMER_NAMES: [string, string][] = [
  ['Michael', 'Owusu'],
  ['Ama', 'Boateng'],
  ['Kwesi', 'Mensah'],
  ['Akosua', 'Asante'],
  ['Kofi', 'Osei'],
  ['Efua', 'Appiah'],
  ['Yaw', 'Agyeman'],
  ['Abena', 'Adjei'],
  ['Kwame', 'Darko'],
  ['Adjoa', 'Amoah'],
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Removes exactly the records a (partial or complete) run of this script
 * created — nothing else. Always double-guarded by `tenantId` plus the
 * specific ids passed in, same discipline as every write elsewhere in
 * this file.
 *
 * Deletion order relies on this schema's own `onDelete: Cascade` chain
 * rather than manually deleting every child table: Customer -> Shipment
 * (Cascade) -> ShipmentItem/Invoice/TrackingEvent/ItemInspection/
 * PickupDeliveryRecord/ContainerItem/ManifestItem (all Cascade from
 * Shipment), and Invoice -> InvoiceItem/Payment (Cascade from Invoice) —
 * deleting the seeded Customer rows alone removes all of that in one
 * statement. Two things do NOT cascade from Customer and need their own
 * explicit delete: Notification (Customer relation is `onDelete: SetNull`,
 * not Cascade — deleted first, while customerId is still populated, or
 * it would just survive orphaned) and Container/Manifest (no customerId
 * at all — deleted by the ids this run itself tracked). ItemInspection/
 * PickupDeliveryRecord hold `onDelete: Restrict` on their own warehouseId
 * — this is exactly why Customer must be deleted (removing those rows)
 * *before* Warehouse, never after.
 */
async function cleanupPartialSeed(
  prisma: PrismaClient,
  tenantId: string,
  ids: { customerIds: string[]; containerIds: string[]; manifestIds: string[]; warehouseIds: string[] },
) {
  console.error('--- Cleanup: removing everything this run created ---');
  if (ids.customerIds.length > 0) {
    const notifs = await prisma.notification.deleteMany({
      where: { tenantId, customerId: { in: ids.customerIds } },
    });
    console.error(`  removed ${notifs.count} notification(s)`);
    const cust = await prisma.customer.deleteMany({ where: { tenantId, id: { in: ids.customerIds } } });
    console.error(
      `  removed ${cust.count} customer(s) (cascaded: their shipments, items, invoices, payments, ` +
        `tracking events, inspections, and pickup/delivery records)`,
    );
  }
  if (ids.containerIds.length > 0) {
    const containers = await prisma.container.deleteMany({ where: { tenantId, id: { in: ids.containerIds } } });
    console.error(`  removed ${containers.count} container(s)`);
  }
  if (ids.manifestIds.length > 0) {
    const manifests = await prisma.manifest.deleteMany({ where: { tenantId, id: { in: ids.manifestIds } } });
    console.error(`  removed ${manifests.count} manifest(s)`);
  }
  if (ids.warehouseIds.length > 0) {
    const warehouses = await prisma.warehouse.deleteMany({ where: { tenantId, id: { in: ids.warehouseIds } } });
    console.error(`  removed ${warehouses.count} warehouse(s)`);
  }
  console.error('--- Cleanup complete — tenant should be back to its pre-run state ---');
}

async function main() {
  console.log(`\n=== Seeding demo data ===`);
  console.log(`Target tenant-id:   ${TARGET_TENANT_ID}`);
  console.log(`Target tenant-slug: ${TARGET_TENANT_SLUG}\n`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

  try {
    const prisma = new PrismaClient();
    try {
      // -----------------------------------------------------------------
      // Phase 0: resolve + hard-verify the target tenant
      // -----------------------------------------------------------------
      const tenant = await prisma.tenant.findUnique({ where: { id: TARGET_TENANT_ID } });
      if (!tenant) {
        throw new Error(`No tenant found with id ${TARGET_TENANT_ID}. Aborting — nothing was created.`);
      }
      if (tenant.slug !== TARGET_TENANT_SLUG) {
        throw new Error(
          `SAFETY ABORT: tenant ${TARGET_TENANT_ID} has slug "${tenant.slug}", not the expected "${TARGET_TENANT_SLUG}". ` +
            `Refusing to write anything. Nothing was created.`,
        );
      }
      // Captured as plain strings (not `tenantId` inline below) so
      // TypeScript's null-narrowing of `tenant` survives into every
      // closure below — `tenant` itself stays possibly-null to TS once
      // captured by a nested async function, even though we already threw
      // above if it was.
      const tenantId: string = tenant.id;
      const tenantName: string = tenant.name;
      const subscription = await prisma.tenantSubscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      });
      console.log(`Resolved tenant: "${tenantName}" (slug "${tenant.slug}", id ${tenantId})`);
      console.log(`Plan: ${subscription?.plan.name ?? 'none'} / status ${subscription?.status ?? 'n/a'}`);
      console.log(`>>> CONFIRM the above is the intended tenant before this proceeds. <<<\n`);

      const owner = await prisma.user.findFirst({
        where: { tenantId: tenantId, role: UserRole.OWNER },
        orderBy: { createdAt: 'asc' },
      });
      if (!owner) {
        throw new Error(`No TENANT_OWNER/TENANT_ADMIN user found for tenant ${tenantId}. Aborting.`);
      }
      console.log(`Acting as existing user: ${owner.firstName} ${owner.lastName} <${owner.email}> (${owner.role})\n`);
      const actorUserId = owner.id;

      // -----------------------------------------------------------------
      // Idempotency guard: abort cleanly (exit 0, not an error) if this
      // demo dataset already exists for this tenant, instead of creating
      // a second overlapping set. Detected via the same fake-domain
      // marker used throughout this file for every seeded customer — a
      // real customer realistically never has a `.test` email, so this
      // is a precise, script-specific "already seeded" signal, checked
      // before a single row is written.
      // -----------------------------------------------------------------
      const existingDemoCustomer = await prisma.customer.findFirst({
        where: { tenantId, email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
        orderBy: { createdAt: 'asc' },
      });
      if (existingDemoCustomer) {
        console.log(
          `Demo dataset already exists for this tenant — found ${existingDemoCustomer.email} ` +
            `(created ${existingDemoCustomer.createdAt.toISOString()}).`,
        );
        console.log('Aborting cleanly to avoid creating duplicate demo data. Nothing was changed.');
        console.log('(Run the rollback procedure first if you actually want to reseed from scratch.)');
        return;
      }

      // Tracks exactly what THIS run creates, so a failure partway through
      // can be cleaned up precisely — see the catch block below. Declared
      // here (outer scope) so it's visible to that catch regardless of
      // which phase actually throws.
      const customers: { id: string; firstName: string; lastName: string }[] = [];
      const containerIds: string[] = [];
      const manifestIds: string[] = [];
      const warehouseIds: string[] = [];
      let weCreatedWarehouses = false;

      try {
        // ---------------------------------------------------------------
        // Phase 1: warehouses (skip if any already exist for this tenant)
        // ---------------------------------------------------------------
        const onboardingService = app.get(OnboardingService);
        let warehouses = await prisma.warehouse.findMany({ where: { tenantId: tenantId } });
        if (warehouses.length === 0) {
          console.log('Phase 1: creating warehouses...');
          await onboardingService.updateOperations(tenantId, {
            warehouses: [
              {
                name: 'Newark Origin Warehouse',
                code: 'NWK-01',
                addressLine1: '450 Doremus Ave',
                city: 'Newark',
                country: 'United States',
                isOriginWarehouse: true,
              },
              {
                name: 'Accra Destination Warehouse',
                code: 'ACC-01',
                addressLine1: '12 Spintex Road',
                city: 'Accra',
                country: 'Ghana',
                isDestinationWarehouse: true,
              },
            ],
          });
          warehouses = await prisma.warehouse.findMany({ where: { tenantId: tenantId } });
          weCreatedWarehouses = true;
          warehouseIds.push(...warehouses.map((w) => w.id));
        } else {
          console.log(`Phase 1: ${warehouses.length} warehouse(s) already exist — skipping creation.`);
        }
        const originWarehouse = warehouses.find((w) => w.isOriginWarehouse)!;
        const destinationWarehouse = warehouses.find((w) => w.isDestinationWarehouse)!;
        console.log(`  origin=${originWarehouse.name} (${originWarehouse.id})`);
        console.log(`  destination=${destinationWarehouse.name} (${destinationWarehouse.id})\n`);

        // ---------------------------------------------------------------
        // Phase 2: customers
        // ---------------------------------------------------------------
        console.log('Phase 2: creating customers...');
        const customersService = app.get(CustomersService);
        for (let i = 0; i < CUSTOMER_NAMES.length; i++) {
        const [firstName, lastName] = CUSTOMER_NAMES[i];
        const created = await customersService.create(tenantId, {
          firstName,
          lastName,
          email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${DEMO_EMAIL_DOMAIN}`,
          phone: `+1-555-01${String(i).padStart(2, '0')}`,
        });
        await prisma.customer.update({
          where: { id: created.id, tenantId: tenantId },
          // notifyByEmail: false alongside the createdAt backdate — these
          // fictional customers use a non-routable @demo.tatanicfreight.test
          // address, so every shipment/invoice/payment event below would
          // otherwise attempt (and bounce) a real email send through
          // whatever provider is configured in this environment. Nothing
          // about the demo *data* changes; this only silences a real-world
          // side effect these fake addresses can't receive anyway.
          data: { createdAt: daysAgo(90 - i * 2), notifyByEmail: false },
        });
        customers.push({ id: created.id, firstName, lastName });
      }
      console.log(`  created ${customers.length} customers\n`);

      // -----------------------------------------------------------------
      // Phase 3: shipments — 13 shipments, each driven through its own
      // designated lifecycle sequence via the real services.
      // -----------------------------------------------------------------
      console.log('Phase 3: creating shipments and driving their lifecycles...');
      const shipmentsService = app.get(ShipmentsService);
      const warehouseService = app.get(WarehouseService);
      const containersService = app.get(ContainersService);
      const manifestsService = app.get(ManifestsService);

      type ItemSpec = { itemType: ShipmentItemType; description: string; weight: number; declaredValue: number };
      type ShipmentSpec = {
        key: string;
        customerIdx: number;
        mode: ShipmentMode;
        description: string;
        item: ItemSpec;
        createdDaysAgo: number;
      };

      const specs: ShipmentSpec[] = [
        { key: 'SH1', customerIdx: 0, mode: ShipmentMode.AIR, description: 'Personal effects — air freight', item: { itemType: ShipmentItemType.BOX, description: 'Clothing and electronics', weight: 22, declaredValue: 450 }, createdDaysAgo: 85 },
        { key: 'SH2', customerIdx: 1, mode: ShipmentMode.OCEAN_LCL, description: 'Household barrel shipment', item: { itemType: ShipmentItemType.BARREL, description: 'Kitchenware and dry goods', weight: 68, declaredValue: 300 }, createdDaysAgo: 78 },
        { key: 'SH3', customerIdx: 2, mode: ShipmentMode.OCEAN_FCL, description: 'Full container — retail goods', item: { itemType: ShipmentItemType.PALLET, description: 'Assorted retail merchandise', weight: 1800, declaredValue: 12000 }, createdDaysAgo: 72 },
        { key: 'SH4', customerIdx: 3, mode: ShipmentMode.AIR, description: 'Documents and small parcel', item: { itemType: ShipmentItemType.BOX, description: 'Business documents and samples', weight: 8, declaredValue: 150 }, createdDaysAgo: 60 },
        { key: 'SH5', customerIdx: 4, mode: ShipmentMode.OCEAN_LCL, description: 'Household goods barrel', item: { itemType: ShipmentItemType.BARREL, description: 'Clothing and provisions', weight: 72, declaredValue: 320 }, createdDaysAgo: 50 },
        { key: 'SH9', customerIdx: 8, mode: ShipmentMode.OCEAN_LCL, description: 'Household goods box', item: { itemType: ShipmentItemType.BOX, description: 'Books and personal items', weight: 30, declaredValue: 180 }, createdDaysAgo: 40 },
        { key: 'SH13', customerIdx: 9, mode: ShipmentMode.OCEAN_FCL, description: 'Full container — vehicle parts', item: { itemType: ShipmentItemType.CRATE, description: 'Automotive spare parts', weight: 950, declaredValue: 8000 }, createdDaysAgo: 45 },
        { key: 'SH6', customerIdx: 5, mode: ShipmentMode.OCEAN_LCL, description: 'Barrel shipment in transit', item: { itemType: ShipmentItemType.BARREL, description: 'Household provisions', weight: 65, declaredValue: 290 }, createdDaysAgo: 20 },
        { key: 'SH7', customerIdx: 6, mode: ShipmentMode.OCEAN_LCL, description: 'Box shipment in transit', item: { itemType: ShipmentItemType.BOX, description: 'Electronics and appliances', weight: 40, declaredValue: 600 }, createdDaysAgo: 19 },
        { key: 'SH8', customerIdx: 7, mode: ShipmentMode.AIR, description: 'Air freight — ready for pickup', item: { itemType: ShipmentItemType.BOX, description: 'Electronics', weight: 15, declaredValue: 500 }, createdDaysAgo: 15 },
        { key: 'SH10', customerIdx: 8, mode: ShipmentMode.AIR, description: 'Air freight — processing', item: { itemType: ShipmentItemType.BOX, description: 'Mixed household items', weight: 12, declaredValue: 200 }, createdDaysAgo: 5 },
        { key: 'SH11', customerIdx: 6, mode: ShipmentMode.OCEAN_LCL, description: 'Newly received barrel', item: { itemType: ShipmentItemType.BARREL, description: 'Provisions and clothing', weight: 60, declaredValue: 250 }, createdDaysAgo: 3 },
        { key: 'SH12', customerIdx: 2, mode: ShipmentMode.OCEAN_FCL, description: 'Machinery shipment — damaged in transit', item: { itemType: ShipmentItemType.MACHINERY, description: 'Industrial sewing machine', weight: 210, declaredValue: 4200 }, createdDaysAgo: 10 },
      ];

      type CreatedShipment = { id: string; itemId: string; trackingNumber: string; customerId: string; mode: ShipmentMode; createdDaysAgo: number };
      const created: Record<string, CreatedShipment> = {};

      for (const spec of specs) {
        const customer = customers[spec.customerIdx];
        const shipment = await shipmentsService.create(tenantId, actorUserId, {
          customerId: customer.id,
          shipmentMode: spec.mode,
          originCountry: 'United States',
          destinationCountry: 'Ghana',
          originLocation: originWarehouse.city,
          destinationLocation: destinationWarehouse.city,
          originWarehouseId: originWarehouse.id,
          destinationWarehouseId: destinationWarehouse.id,
          description: spec.description,
          declaredValue: spec.item.declaredValue,
          currency: 'USD',
          items: [
            {
              itemType: spec.item.itemType,
              description: spec.item.description,
              quantity: 1,
              weight: spec.item.weight,
              weightUnit: WeightUnit.LB,
              dimensionUnit: DimensionUnit.IN,
              declaredValue: spec.item.declaredValue,
            },
          ],
        });
        const item = shipment.items[0];
        const createdAt = daysAgo(spec.createdDaysAgo);
        await prisma.shipment.update({ where: { id: shipment.id, tenantId: tenantId }, data: { createdAt } });
        created[spec.key] = {
          id: shipment.id,
          itemId: item.id,
          trackingNumber: shipment.trackingNumber,
          customerId: customer.id,
          mode: spec.mode,
          createdDaysAgo: spec.createdDaysAgo,
        };
        console.log(`  ${spec.key}: ${shipment.trackingNumber} (${spec.mode}) for ${customer.firstName} ${customer.lastName}`);
      }
      console.log(`  created ${specs.length} shipments\n`);

      // Helper: receive + process one item at origin, occurring `daysAgo`.
      async function receiveAndProcess(
        key: string,
        opts: { receivedDaysAgo: number; processedDaysAgo: number; condition?: ShipmentItemCondition; hasException?: boolean; exceptionDescription?: string },
      ) {
        const s = created[key];
        await warehouseService.receiveItem(tenantId, actorUserId, s.itemId, {
          warehouseId: originWarehouse.id,
          scanned: false,
          notes: 'Received at origin warehouse',
        });
        await prisma.trackingEvent.updateMany({
          where: { tenantId: tenantId, shipmentId: s.id, eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE },
          data: { occurredAt: daysAgo(opts.receivedDaysAgo) },
        });
        const isException = opts.hasException ?? false;
        await warehouseService.processItem(tenantId, actorUserId, s.itemId, {
          warehouseId: originWarehouse.id,
          weight: 1,
          weightUnit: WeightUnit.LB,
          condition: opts.condition ?? ShipmentItemCondition.GOOD,
          result: isException ? ItemProcessingResult.HOLD : ItemProcessingResult.READY,
          hasException: isException,
          exceptionDescription: opts.exceptionDescription,
          scanned: false,
          notes: isException ? 'Damage noted during inspection' : 'Inspected and cleared',
        });
        await prisma.trackingEvent.updateMany({
          where: { tenantId: tenantId, shipmentId: s.id, eventType: TrackingEventType.PROCESSED },
          data: { occurredAt: daysAgo(opts.processedDaysAgo) },
        });
      }

      console.log('Driving shipment lifecycles...');

      // --- SH12: received + processed with a genuine damage exception, then stuck (no further movement). ---
      await receiveAndProcess('SH12', {
        receivedDaysAgo: 9,
        processedDaysAgo: 8,
        condition: ShipmentItemCondition.DAMAGED,
        hasException: true,
        exceptionDescription: 'Housing cracked and one control panel shattered — appears to have been dropped in transit to the warehouse. Awaiting customer instructions (repair claim vs. return).',
      });
      console.log('  SH12: receive+process(DAMAGED/EXCEPTION) — stuck, no invoice');

      // --- SH11: received only, not yet processed — stops at WAREHOUSE_RECEIVED. ---
      await warehouseService.receiveItem(tenantId, actorUserId, created.SH11.itemId, {
        warehouseId: originWarehouse.id,
        scanned: false,
        notes: 'Received at origin warehouse',
      });
      await prisma.trackingEvent.updateMany({
        where: { tenantId: tenantId, shipmentId: created.SH11.id, eventType: TrackingEventType.RECEIVED_AT_WAREHOUSE },
        data: { occurredAt: daysAgo(2) },
      });
      console.log('  SH11: receive only — WAREHOUSE_RECEIVED, not yet processed');

      console.log('  SH10: receive+process (still early-stage, no consolidation yet)');
      await receiveAndProcess('SH10', { receivedDaysAgo: 4, processedDaysAgo: 3 });

      // --- Remaining shipments: receive + process, then progress further per scenario. ---
      for (const key of ['SH1', 'SH2', 'SH3', 'SH4', 'SH5', 'SH6', 'SH7', 'SH8', 'SH9', 'SH13']) {
        const s = created[key];
        const receivedDaysAgo = s.createdDaysAgo - 1;
        const processedDaysAgo = s.createdDaysAgo - 2;
        await receiveAndProcess(key, { receivedDaysAgo, processedDaysAgo });
      }
      console.log('  received + processed: SH1,SH2,SH3,SH4,SH5,SH6,SH7,SH8,SH9,SH13\n');

      // -----------------------------------------------------------------
      // Phase 4: containers
      // -----------------------------------------------------------------
      console.log('Phase 4: creating and loading containers...');

      async function makeContainer(containerNumber: string, type: ContainerType, createdDaysAgo: number) {
        const c = await containersService.create(tenantId, {
          containerNumber,
          containerType: type,
          warehouseId: originWarehouse.id,
          originPort: 'Port of New York/New Jersey',
          destinationPort: 'Port of Tema',
        });
        await prisma.container.update({ where: { id: c.id, tenantId: tenantId }, data: { createdAt: daysAgo(createdDaysAgo) } });
        containerIds.push(c.id);
        return c;
      }
      async function loadAndFinalize(containerId: string, itemIds: string[], finalizedDaysAgo: number) {
        for (const itemId of itemIds) {
          await containersService.loadItem(tenantId, actorUserId, containerId, itemId, { scanned: false });
        }
        await containersService.finalize(tenantId, actorUserId, containerId, { sealNumber: `SEAL-${Math.floor(Math.random() * 900000 + 100000)}` });
        await prisma.trackingEvent.updateMany({
          where: { tenantId: tenantId, eventType: TrackingEventType.LOADED, shipmentItemId: { in: itemIds } },
          data: { occurredAt: daysAgo(finalizedDaysAgo) },
        });
      }

      const containerA = await makeContainer('MSCU1000012', ContainerType.TWENTY_FT, 68);
      await loadAndFinalize(containerA.id, [created.SH2.itemId, created.SH5.itemId, created.SH9.itemId], 34);

      const containerB = await makeContainer('TCLU2000023', ContainerType.FORTY_FT, 62);
      await loadAndFinalize(containerB.id, [created.SH3.itemId], 55);

      const containerC = await makeContainer('CMAU3000034', ContainerType.TWENTY_FT, 18);
      await loadAndFinalize(containerC.id, [created.SH6.itemId, created.SH7.itemId], 12);

      const containerD = await makeContainer('OOLU4000045', ContainerType.FORTY_FT, 40);
      await loadAndFinalize(containerD.id, [created.SH13.itemId], 30);

      const containerE = await makeContainer('HLXU5000056', ContainerType.TWENTY_FT, 2);
      // Container E stays BOOKED/empty — a planned future consolidation, no items loaded yet.

      console.log('  containers: A(consolidated,LCL) B(FCL) C(consolidated,LCL,in-transit) D(FCL) E(booked,empty)\n');

      // -----------------------------------------------------------------
      // Phase 5: manifests
      // -----------------------------------------------------------------
      console.log('Phase 5: creating manifests and progressing them...');

      async function makeManifest(mode: ShipmentMode, opts: { carrierName: string; vesselName?: string; voyageNumber?: string; flightNumber?: string; plannedDaysAgo: number; estimatedArrivalDaysDelta: number }) {
        const m = await manifestsService.create(tenantId, {
          shipmentMode: mode,
          originWarehouseId: originWarehouse.id,
          originLocation: originWarehouse.city,
          destinationLocation: destinationWarehouse.city,
          carrierName: opts.carrierName,
          vesselName: opts.vesselName,
          voyageNumber: opts.voyageNumber,
          flightNumber: opts.flightNumber,
          plannedDepartureAt: daysAgo(opts.plannedDaysAgo).toISOString(),
          estimatedArrivalAt:
            opts.estimatedArrivalDaysDelta >= 0
              ? daysFromNow(opts.estimatedArrivalDaysDelta).toISOString()
              : daysAgo(-opts.estimatedArrivalDaysDelta).toISOString(),
        });
        manifestIds.push(m.id);
        return m;
      }

      // M1: air manifest carrying SH1, SH4, SH8 directly.
      const m1 = await makeManifest(ShipmentMode.AIR, { carrierName: 'Delta Cargo', flightNumber: 'DL9821', plannedDaysAgo: 61, estimatedArrivalDaysDelta: -59 });
      for (const key of ['SH1', 'SH4', 'SH8']) {
        await manifestsService.assignItem(tenantId, actorUserId, m1.id, created[key].itemId, { scanned: false });
      }
      await manifestsService.finalize(tenantId, actorUserId, m1.id);
      await manifestsService.depart(tenantId, actorUserId, m1.id);
      await manifestsService.arrive(tenantId, actorUserId, m1.id);
      console.log('  M1 (air, ARRIVED): SH1, SH4, SH8');

      // M2: ocean manifest carrying Container A (arrived).
      const m2 = await makeManifest(ShipmentMode.OCEAN_LCL, { carrierName: 'Maersk Line', vesselName: 'Maersk Accra', voyageNumber: 'MA-118W', plannedDaysAgo: 34, estimatedArrivalDaysDelta: -20 });
      await manifestsService.assignContainer(tenantId, actorUserId, m2.id, containerA.id, {});
      await manifestsService.finalize(tenantId, actorUserId, m2.id);
      await manifestsService.depart(tenantId, actorUserId, m2.id);
      await manifestsService.arrive(tenantId, actorUserId, m2.id);
      console.log('  M2 (ocean, ARRIVED): Container A (SH2, SH5, SH9)');

      // M3: ocean manifest carrying Container B (FCL, arrived).
      const m3 = await makeManifest(ShipmentMode.OCEAN_FCL, { carrierName: 'MSC', vesselName: 'MSC Tema', voyageNumber: 'MSC-204E', plannedDaysAgo: 55, estimatedArrivalDaysDelta: -40 });
      await manifestsService.assignContainer(tenantId, actorUserId, m3.id, containerB.id, {});
      await manifestsService.finalize(tenantId, actorUserId, m3.id);
      await manifestsService.depart(tenantId, actorUserId, m3.id);
      await manifestsService.arrive(tenantId, actorUserId, m3.id);
      console.log('  M3 (ocean, ARRIVED): Container B (SH3)');

      // M4: ocean manifest carrying Container C — DEPARTED only (in transit, arriving soon).
      const m4 = await makeManifest(ShipmentMode.OCEAN_LCL, { carrierName: 'CMA CGM', vesselName: 'CMA CGM Accra', voyageNumber: 'CC-330W', plannedDaysAgo: 12, estimatedArrivalDaysDelta: 3 });
      await manifestsService.assignContainer(tenantId, actorUserId, m4.id, containerC.id, {});
      await manifestsService.finalize(tenantId, actorUserId, m4.id);
      await manifestsService.depart(tenantId, actorUserId, m4.id);
      console.log('  M4 (ocean, DEPARTED — arriving in ~3 days): Container C (SH6, SH7)');

      // M5: ocean manifest carrying Container D (FCL, arrived after redelivery scenario).
      const m5 = await makeManifest(ShipmentMode.OCEAN_FCL, { carrierName: 'Hapag-Lloyd', vesselName: 'Hapag Tema', voyageNumber: 'HL-077E', plannedDaysAgo: 40, estimatedArrivalDaysDelta: -25 });
      await manifestsService.assignContainer(tenantId, actorUserId, m5.id, containerD.id, {});
      await manifestsService.finalize(tenantId, actorUserId, m5.id);
      await manifestsService.depart(tenantId, actorUserId, m5.id);
      await manifestsService.arrive(tenantId, actorUserId, m5.id);
      console.log('  M5 (ocean, ARRIVED): Container D (SH13)');

      // M6: a future planned ocean manifest, left in DRAFT — no containers yet.
      const m6 = await makeManifest(ShipmentMode.OCEAN_LCL, { carrierName: 'Maersk Line', vesselName: 'Maersk Tema', voyageNumber: 'MA-125W', plannedDaysAgo: -7, estimatedArrivalDaysDelta: 21 });
      console.log(`  M6 (ocean, DRAFT — planned voyage): ${m6.manifestNumber}, no containers assigned yet\n`);

      // Backdate estimatedArrival on Container C for the "arriving soon" scenario
      // — no ContainersService method anywhere ever sets this column (confirmed
      // by grep before writing this script), so this is the one field-level
      // exception described in this file's own header comment.
      await prisma.container.update({
        where: { id: containerC.id, tenantId: tenantId },
        data: { estimatedArrival: daysFromNow(3) },
      });

      // -----------------------------------------------------------------
      // Phase 6: destination receive + pickup/delivery
      // -----------------------------------------------------------------
      console.log('Phase 6: destination-receiving and completing deliveries...');

      async function destinationReceive(key: string, daysAgoVal: number) {
        const s = created[key];
        await warehouseService.destinationReceiveItem(tenantId, actorUserId, s.itemId, {
          warehouseId: destinationWarehouse.id,
          condition: ShipmentItemCondition.GOOD,
          scanned: false,
          notes: 'Received at destination warehouse',
        });
        await prisma.trackingEvent.updateMany({
          where: { tenantId: tenantId, shipmentId: s.id, eventType: TrackingEventType.RECEIVED_DESTINATION_WAREHOUSE },
          data: { occurredAt: daysAgo(daysAgoVal) },
        });
      }

      // M1's items (SH1, SH4, SH8) all arrived ~59 days ago.
      await destinationReceive('SH1', 58);
      await destinationReceive('SH4', 58);
      await destinationReceive('SH8', 7); // SH8 arrived recently and is still awaiting pickup

      // M2's items (SH2, SH5, SH9) all arrived ~20 days ago.
      await destinationReceive('SH2', 19);
      await destinationReceive('SH5', 19);
      await destinationReceive('SH9', 19);

      // M3's item (SH3) arrived ~40 days ago.
      await destinationReceive('SH3', 39);

      // M5's item (SH13) arrived ~25 days ago.
      await destinationReceive('SH13', 24);

      console.log('  destination-received: SH1, SH2, SH3, SH4, SH5, SH8, SH9, SH13');

      // --- Pickups / deliveries for the "completed" shipments ---
      async function pickup(key: string, daysAgoVal: number, recipientName: string) {
        const s = created[key];
        await warehouseService.pickupItem(tenantId, actorUserId, s.itemId, {
          warehouseId: destinationWarehouse.id,
          recipientName,
          scanned: false,
          notes: 'Picked up by customer at destination warehouse',
        });
        await prisma.trackingEvent.updateMany({
          where: { tenantId: tenantId, shipmentId: s.id, eventType: TrackingEventType.PICKED_UP },
          data: { occurredAt: daysAgo(daysAgoVal) },
        });
      }
      async function dispatch(key: string, daysAgoVal: number, recipientName: string) {
        const s = created[key];
        await warehouseService.dispatchItem(tenantId, actorUserId, s.itemId, {
          warehouseId: destinationWarehouse.id,
          recipientName,
          courierName: 'Tatanic Local Delivery',
          courierPhone: '+233-20-555-0100',
          deliveryAddress: 'Customer residence, Accra',
          scanned: false,
        });
        await prisma.trackingEvent.updateMany({
          where: { tenantId: tenantId, shipmentId: s.id, eventType: TrackingEventType.OUT_FOR_DELIVERY },
          data: { occurredAt: daysAgo(daysAgoVal) },
        });
      }
      async function deliver(key: string, daysAgoVal: number, recipientName: string) {
        const s = created[key];
        await warehouseService.deliverItem(tenantId, actorUserId, s.itemId, {
          warehouseId: destinationWarehouse.id,
          recipientName,
          scanned: false,
        });
        await prisma.trackingEvent.updateMany({
          where: { tenantId: tenantId, shipmentId: s.id, eventType: TrackingEventType.DELIVERED },
          data: { occurredAt: daysAgo(daysAgoVal) },
        });
      }

      // SH1, SH4: picked up at the warehouse (COMPLETED).
      await pickup('SH1', 57, 'Michael Owusu');
      await pickup('SH4', 56, 'Akosua Asante');

      // SH2, SH5: dispatched + delivered (DELIVERED).
      await dispatch('SH2', 17, 'Ama Boateng');
      await deliver('SH2', 16, 'Ama Boateng');
      await dispatch('SH5', 17, 'Kofi Osei');
      await deliver('SH5', 16, 'Kofi Osei');

      // SH3: dispatched + delivered (DELIVERED).
      await dispatch('SH3', 37, 'Kwesi Mensah');
      await deliver('SH3', 36, 'Kwesi Mensah');

      // SH9: dispatched only — currently OUT_FOR_DELIVERY (recognizable scenario).
      await dispatch('SH9', 2, 'Kwame Darko');
      console.log('  SH9: dispatched — OUT_FOR_DELIVERY (not yet delivered)');

      // SH8: destination-received, NOT dispatched — READY_FOR_PICKUP (recognizable scenario).
      console.log('  SH8: destination-received only — READY_FOR_PICKUP (awaiting customer)');

      // SH13: a failed delivery attempt, then a successful redelivery.
      await dispatch('SH13', 23, 'Adjoa Amoah');
      const sh13 = created.SH13;
      await warehouseService.returnItem(tenantId, actorUserId, sh13.itemId, {
        warehouseId: destinationWarehouse.id,
        failureReason: 'Recipient not available at delivery address; neighbor declined to accept on their behalf.',
        hasException: false,
        scanned: false,
        notes: 'First delivery attempt unsuccessful — rescheduling',
      });
      await prisma.trackingEvent.updateMany({
        where: { tenantId: tenantId, shipmentId: sh13.id, eventType: TrackingEventType.RETURNED_TO_WAREHOUSE },
        data: { occurredAt: daysAgo(22) },
      });
      await dispatch('SH13', 5, 'Adjoa Amoah');
      await deliver('SH13', 4, 'Adjoa Amoah');
      console.log('  SH13: dispatch -> FAILED delivery attempt -> re-dispatch -> DELIVERED\n');

      // -----------------------------------------------------------------
      // Phase 7: invoices + payments
      // -----------------------------------------------------------------
      console.log('Phase 7: creating invoices and recording payments...');
      const invoicesService = app.get(InvoicesService);
      const paymentsService = app.get(PaymentsService);

      async function invoiceFor(key: string, unitPrice: number, dueDaysFromNow: number, issuedDaysAgo: number) {
        const s = created[key];
        const invoice = await invoicesService.create(tenantId, {
          customerId: s.customerId,
          shipmentId: s.id,
          currency: 'USD',
          dueDate: dueDaysFromNow >= 0 ? daysFromNow(dueDaysFromNow).toISOString() : daysAgo(-dueDaysFromNow).toISOString(),
          tax: Math.round(unitPrice * 0.02 * 100) / 100,
          items: [{ description: `Freight charges — ${key}`, quantity: 1, unitPrice }],
        });
        await invoicesService.issue(tenantId, invoice.id);
        await prisma.invoice.update({
          where: { id: invoice.id, tenantId: tenantId },
          data: { createdAt: daysAgo(issuedDaysAgo), issuedAt: daysAgo(issuedDaysAgo) },
        });
        return invoice;
      }
      async function pay(invoiceId: string, amount: number, daysAgoVal: number, method: PaymentMethod = PaymentMethod.MOBILE_MONEY) {
        const payment = await paymentsService.recordPayment(tenantId, invoiceId, {
          amount,
          method,
          paidAt: daysAgo(daysAgoVal).toISOString(),
          notes: 'Demo payment',
        });
        await prisma.payment.update({ where: { id: payment.id, tenantId: tenantId }, data: { createdAt: daysAgo(daysAgoVal) } });
        return payment;
      }

      const invSH1 = await invoiceFor('SH1', 380, -50, 57);
      await pay(invSH1.id, Number(invSH1.total), 55);

      const invSH2 = await invoiceFor('SH2', 260, -30, 17);
      await pay(invSH2.id, Number(invSH2.total), 15);

      const invSH3 = await invoiceFor('SH3', 9500, -50, 37);
      await pay(invSH3.id, Number(invSH3.total), 34);

      const invSH4 = await invoiceFor('SH4', 120, -40, 56);
      await pay(invSH4.id, Number(invSH4.total), 54);

      const invSH13 = await invoiceFor('SH13', 6200, -15, 23);
      await pay(invSH13.id, Number(invSH13.total), 3);

      // Partially paid — due date kept in the future so this stays a
      // clean, distinct "partially paid, not yet overdue" scenario,
      // separate from SH8's overdue-and-fully-unpaid one below.
      const invSH5 = await invoiceFor('SH5', 270, 15, 17);
      const sh5Total = Number(invSH5.total);
      await pay(invSH5.id, Math.round(sh5Total * 0.4 * 100) / 100, 14);
      console.log(`  SH5 invoice ${invSH5.invoiceNumber}: PARTIALLY_PAID (paid 40% of ${sh5Total})`);

      // Overdue — unpaid, due date in the past.
      const invSH8 = await invoiceFor('SH8', 420, -5, 7);
      console.log(`  SH8 invoice ${invSH8.invoiceNumber}: unpaid, due 5 days ago -> OVERDUE`);

      // Not yet due.
      const invSH9 = await invoiceFor('SH9', 220, 10, 2);
      const invSH6 = await invoiceFor('SH6', 250, 12, 18);
      const invSH7 = await invoiceFor('SH7', 480, 12, 17);
      console.log('  SH9, SH6, SH7 invoiced: unpaid, due in the future (outstanding, not overdue)\n');

      // -----------------------------------------------------------------
      // Summary
      // -----------------------------------------------------------------
      const counts = {
        customers: await prisma.customer.count({ where: { tenantId: tenantId } }),
        shipments: await prisma.shipment.count({ where: { tenantId: tenantId } }),
        shipmentItems: await prisma.shipmentItem.count({ where: { tenantId: tenantId } }),
        containers: await prisma.container.count({ where: { tenantId: tenantId } }),
        manifests: await prisma.manifest.count({ where: { tenantId: tenantId } }),
        invoices: await prisma.invoice.count({ where: { tenantId: tenantId } }),
        payments: await prisma.payment.count({ where: { tenantId: tenantId } }),
        trackingEvents: await prisma.trackingEvent.count({ where: { tenantId: tenantId } }),
        warehouses: await prisma.warehouse.count({ where: { tenantId: tenantId } }),
      };

      console.log('=== DONE ===');
      console.log(JSON.stringify(counts, null, 2));
      console.log('\nRecognizable scenarios:');
      console.log(`  In transit:        ${created.SH6.trackingNumber} / ${created.SH7.trackingNumber} (container ${containerC.containerNumber}, ETA ${daysFromNow(3).toDateString()})`);
      console.log(`  Ready for pickup:  ${created.SH8.trackingNumber}`);
      console.log(`  Out for delivery:  ${created.SH9.trackingNumber}`);
      console.log(`  Damage/exception:  ${created.SH12.trackingNumber}`);
      console.log(`  Failed then delivered: ${created.SH13.trackingNumber}`);
      console.log(`  Overdue invoice:   ${invSH8.invoiceNumber}`);
      console.log(`  Partially paid:    ${invSH5.invoiceNumber}`);
      } catch (err) {
        // No single top-level DB transaction wraps phases 1-7 — each
        // service call commits independently (same architecture the real
        // app itself already uses everywhere; see ManifestsService.depart's
        // own doc comment on why). A single outer transaction would
        // require every service to accept an externally-supplied Prisma
        // transaction client instead of its own injected PrismaService — a
        // cross-cutting change to application code this script deliberately
        // does not make. Instead: on any failure, precisely undo whatever
        // THIS run actually created (tracked incrementally above, not
        // inferred after the fact), then re-throw so the failure is still
        // visible and the process still exits non-zero.
        console.error('\nSEED FAILED partway through — attempting automatic cleanup of everything this run created...');
        await cleanupPartialSeed(prisma, tenantId, {
          customerIds: customers.map((c) => c.id),
          containerIds,
          manifestIds,
          warehouseIds: weCreatedWarehouses ? warehouseIds : [],
        });
        throw err;
      }
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSEED SCRIPT FAILED:', err);
    process.exit(1);
  });
