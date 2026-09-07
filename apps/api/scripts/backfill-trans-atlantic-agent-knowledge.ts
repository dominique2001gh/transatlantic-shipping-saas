/**
 * Public Website AI Agent, Phase 1 — one-time (re-runnable) backfill of
 * Trans Atlantic's initial TenantAgentKnowledgeEntry rows, plus its
 * assistant display name ("Eddie" — see Tenant.agentName's own doc
 * comment; this is a per-tenant value, not a global default, so this
 * script only ever sets it for the "transatlantic" tenant it looks up).
 *
 * Deliberately NOT part of prisma/seed.ts: that file's own header comment
 * says "Never run against a production database" (it creates fake
 * customers/shipments with fixed dev credentials). Trans Atlantic is a
 * real production tenant, so its real public-agent knowledge needs a
 * script that is *safe* to run against production later — this one only
 * touches TenantAgentKnowledgeEntry rows, one TenantEntitlement row, and
 * Tenant.agentName, nothing else, and is fully idempotent (safe to re-run
 * any number of times against the same tenant).
 *
 * Every fact below is drawn directly from this codebase's own existing,
 * real content — apps/web/src/lib/site-config.ts (company/contact/
 * location), apps/web/src/lib/services-data.ts (service descriptions),
 * and this tenant's real Warehouse/TenantSettings rows (origin/destination
 * warehouse cities and countries) — nothing here is invented. Facts that
 * aren't confirmed anywhere in the codebase (e.g. a specific Tema/port
 * handling process beyond the one Accra warehouse on file, specific
 * customs-clearance procedures, or business hours/SLAs) are deliberately
 * OMITTED rather than guessed — see the Phase 1 audit report for the full
 * list of what was left out and why, for human review before adding.
 *
 * Run locally: `npx ts-node -r tsconfig-paths/register scripts/backfill-trans-atlantic-agent-knowledge.ts`
 * (or via `pnpm --filter ./apps/api exec ts-node ...`), from apps/api.
 */
import { EntitlementFeature, PrismaClient, TenantAgentKnowledgeKind } from '@prisma/client';

const prisma = new PrismaClient();

interface KnowledgeEntryInput {
  kind: TenantAgentKnowledgeKind;
  title: string;
  body: string;
}

const TRANS_ATLANTIC_KNOWLEDGE: KnowledgeEntryInput[] = [
  // ---- FACTS -------------------------------------------------------------
  {
    kind: 'FACT',
    title: 'Company Overview',
    body: 'Trans Atlantic Logistics Solutions ("International Shipping. Simplified.") provides ocean, air, and RoRo freight forwarding with warehousing, consolidation, and shipment tracking for cargo moving between the United States and destinations worldwide.',
  },
  {
    kind: 'FACT',
    title: 'Services Offered',
    body: 'Trans Atlantic offers five core services: Ocean Freight (LCL and FCL), Air Freight, LCL Shipping (less-than-container-load consolidation), RoRo / Vehicle Shipping, and Warehousing (receiving, storage, consolidation, and cross-docking).',
  },
  {
    kind: 'FACT',
    title: 'Ocean Freight (LCL and FCL)',
    body: 'Ocean freight moves cargo of any size by sea. Customers can choose LCL (Less than Container Load — cargo is consolidated with other shipments heading to the same destination, so you only pay for the space you use) or FCL (booking exclusive container space for larger volumes). The general flow: cargo is received, inspected, and measured at the origin warehouse; loaded into a container; booked onto an ocean vessel; and on arrival is processed and made ready for pickup or delivery. Well suited to bulky or heavy cargo that is costly to move by air, and to businesses or individuals shipping commercial inventory or household goods internationally.',
  },
  {
    kind: 'FACT',
    title: 'Air Freight',
    body: 'Air freight is for cargo that needs to move quickly — urgent documents, time-sensitive parts, high-value cargo, or smaller shipments where transit time matters more than cost per pound. Cargo is dropped off (or picked up) at the origin warehouse, documented and weighed, booked onto an available flight, and processed for pickup or onward delivery on arrival. Air freight has significantly shorter transit times than ocean freight and is a practical complement to it for mixed shipping needs.',
  },
  {
    kind: 'FACT',
    title: 'RoRo / Vehicle Shipping',
    body: 'RoRo (Roll-on/Roll-off) shipping is a purpose-built way to move drivable vehicles by ocean freight — vehicles are driven directly onto a specialized vessel and secured for transit rather than loaded into a container. The process: the vehicle is dropped off at the origin warehouse ahead of the sailing date; inspected and documented (including title status); driven onto the RoRo vessel and secured; and on arrival is processed through customs where applicable and released for pickup. Suited to individuals shipping a personal vehicle or dealers/businesses shipping multiple vehicles.',
  },
  {
    kind: 'FACT',
    title: 'Warehousing',
    body: 'Trans Atlantic\'s warehousing service supports the shipping process itself — receiving cargo from multiple sources, holding it briefly, consolidating it with other shipments, and preparing it for the next leg of its journey. It supports consolidating multiple purchases into a single shipment, providing a receiving point before freight is booked, cross-docking cargo moving straight through to the next carrier, and coordinating drop-to-door delivery after arrival.',
  },
  {
    kind: 'FACT',
    title: 'Origin Warehouse — Dallas-Fort Worth, Texas',
    body: 'Trans Atlantic\'s origin warehouse is located in Dallas-Fort Worth, Texas, United States. This is where outbound cargo from the U.S. is received, inspected, measured, and prepared for its onward journey by ocean, air, or RoRo freight.',
  },
  {
    kind: 'FACT',
    title: 'Destination Handling — Ghana',
    body: 'Trans Atlantic\'s confirmed destination warehouse is located in Accra, Ghana. Cargo shipped through Trans Atlantic is currently configured to move between the United States (origin) and Ghana (destination). If a customer asks about shipping to or from a different country, do not assume it is supported — direct them to contact Trans Atlantic directly to confirm.',
  },
  {
    kind: 'FACT',
    title: 'General Shipping Process',
    body: 'The typical journey for a shipment: (1) cargo is received and logged at the origin warehouse; (2) it is inspected, weighed, and measured; (3) it is consolidated and loaded into a container (ocean) or onto a manifest (air); (4) the container/shipment departs and travels to its destination; (5) on arrival, it is received and processed at the destination warehouse, with any damage or discrepancies flagged rather than silently accepted; (6) the customer is notified and the item is handed off via pickup or dispatched delivery. Every step is recorded, so a customer can check their shipment\'s status at any time using their tracking number.',
  },
  {
    kind: 'FACT',
    title: 'Pickup and Delivery',
    body: 'Once a shipment has been received and processed at the destination warehouse, it is handed off to the customer either by in-person pickup at the destination warehouse or by dispatched delivery to the customer\'s address, depending on what has been arranged. Exact pickup/delivery arrangements and timing are handled directly with Trans Atlantic staff — this assistant cannot schedule or confirm a specific pickup or delivery time.',
  },
  {
    kind: 'FACT',
    title: 'Shipment Tracking',
    body: 'Every shipment gets a tracking number that customers can use to check status at any time on the public Tracking page, without needing an account. Tracking shows the shipment\'s recorded history — for example when it was received, processed, loaded, departed, or arrived — as it actually happens; this assistant cannot look up or state the live status of any specific shipment itself, since it has no access to shipment data. Always direct a customer asking about their specific shipment\'s status to the Tracking page.',
  },
  {
    kind: 'FACT',
    title: 'Customer Login',
    body: 'Customers with an existing account can sign in via Customer Login to see their own shipments, invoices, and documents in one place. A customer without an account yet does not need one just to track a shipment — the public Tracking page works without signing in.',
  },
  {
    kind: 'FACT',
    title: 'Requesting a Quote',
    body: 'Trans Atlantic does not publish fixed shipping rates, since price depends on cargo size/weight, mode (ocean, air, RoRo), and destination. A customer who wants pricing should use the Request a Quote page and provide their shipment details; Trans Atlantic staff will follow up. This assistant must never state or estimate a specific rate or price.',
  },
  {
    kind: 'FACT',
    title: 'Contact Information',
    body: 'Trans Atlantic can be reached by email at info@talogisticssolutions.com, by phone at +1 (214) 493-7745, or via WhatsApp at the same number. The Contact page on the website is also available for written inquiries.',
  },
  // ---- FAQs ----------------------------------------------------------------
  {
    kind: 'FAQ',
    title: 'How do I track my shipment?',
    body: 'Go to the Tracking page and enter your tracking number. You do not need an account to track a shipment.',
  },
  {
    kind: 'FAQ',
    title: 'What countries do you ship between?',
    body: 'Trans Atlantic\'s confirmed route is the United States (origin, Dallas-Fort Worth) to Ghana (destination, Accra). If you need a different route, please contact Trans Atlantic directly to confirm whether it is supported.',
  },
  {
    kind: 'FAQ',
    title: 'How much will it cost to ship my item?',
    body: 'I can\'t provide pricing — cost depends on your cargo\'s size, weight, mode of shipping, and destination. Please use the Request a Quote page and Trans Atlantic staff will get back to you with pricing.',
  },
  {
    kind: 'FAQ',
    title: 'When will my shipment arrive?',
    body: 'I don\'t have access to live shipment data, so I can\'t give you an estimated arrival date. Please check the Tracking page with your tracking number for the latest recorded status, or contact Trans Atlantic directly.',
  },
  {
    kind: 'FAQ',
    title: 'Do you ship vehicles?',
    body: 'Yes — Trans Atlantic offers RoRo (Roll-on/Roll-off) shipping for drivable vehicles, as well as containerized options depending on the vehicle. Contact Trans Atlantic or request a quote for details specific to your vehicle.',
  },
  {
    kind: 'FAQ',
    title: 'Do you handle customs clearance?',
    body: 'Cargo is processed through customs where applicable as part of the shipping process, but I don\'t have verified details on customs procedures or requirements for your specific shipment or destination. Please contact Trans Atlantic directly for customs-related questions.',
  },
  {
    kind: 'FAQ',
    title: 'How do I sign in to see my shipments?',
    body: 'If you already have a Trans Atlantic account, use Customer Login. If you\'re not sure whether you have an account, or need one set up, please contact Trans Atlantic.',
  },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'transatlantic' } });
  if (!tenant) {
    throw new Error('Tenant "transatlantic" not found — refusing to run against an unknown database.');
  }

  // Replace-all, the same "the whole list is the unit of edit" pattern
  // SiteConfigService.replaceLocations already uses for TenantLocation —
  // makes this script safely re-runnable as the content is refined.
  await prisma.$transaction(async (tx) => {
    await tx.tenantAgentKnowledgeEntry.deleteMany({ where: { tenantId: tenant.id } });
    await tx.tenantAgentKnowledgeEntry.createMany({
      data: TRANS_ATLANTIC_KNOWLEDGE.map((entry, index) => ({
        tenantId: tenant.id,
        kind: entry.kind,
        title: entry.title,
        body: entry.body,
        sortOrder: index,
      })),
    });
  });
  console.log(`Seeded ${TRANS_ATLANTIC_KNOWLEDGE.length} knowledge entries for ${tenant.name} (${tenant.slug}).`);

  // Explicit entitlement row (rather than relying solely on the "no
  // subscription row = grandfathered" implicit rule PublicAiAgentService
  // also honors) so this is visible and independently toggleable, the same
  // convention AI_AGENT/ANALYTICS entitlement rows already use elsewhere.
  await prisma.tenantEntitlement.upsert({
    where: { tenantId_feature: { tenantId: tenant.id, feature: EntitlementFeature.PUBLIC_AI_AGENT } },
    update: { enabled: true },
    create: { tenantId: tenant.id, feature: EntitlementFeature.PUBLIC_AI_AGENT, enabled: true },
  });
  console.log(`Enabled PUBLIC_AI_AGENT entitlement for ${tenant.slug}.`);

  await prisma.tenant.update({ where: { id: tenant.id }, data: { agentName: 'Eddie' } });
  console.log(`Set assistant display name to "Eddie" for ${tenant.slug}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
