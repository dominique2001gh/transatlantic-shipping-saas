import type { Metadata } from 'next';
import { IconCheckCircle, IconGlobe, IconHeadset, IconLayers, IconMail, IconSearch } from '@/components/icons';
import { AiAgentChatPreview } from '@/components/marketing/AiAgentChatPreview';
import { CTASection } from '@/components/marketing/CTASection';
import { HeroDashboardMockup } from '@/components/marketing/HeroDashboardMockup';
import { OwnerDashboardPreview } from '@/components/marketing/ProductPreviews';
import { LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { workflowSteps } from '@/lib/ananselogix/site-data';
import { platformConfig } from '@/lib/platform-config';

export const metadata: Metadata = {
  description:
    'AnanseLogix gives logistics companies one system to manage packages, warehouses, containers, manifests, customers, payments, tracking and staff — from receiving to final delivery.',
  // Step 3: unprefixed — this page resolves at the AnanseLogix site root
  // (see middleware.ts's hostname routing), so its one true canonical URL
  // is https://ananselogix.com/, not the /ananselogix-prefixed internal
  // route this same content is rewritten from. See ananselogix/layout.tsx's
  // own doc comment for ANANSELOGIX_BASE_URL, which this resolves against.
  alternates: { canonical: '/' },
};

/**
 * Organization + SoftwareApplication structured data — describes the real
 * product and company, nothing fabricated (no ratings/review counts/user
 * numbers, none of which this app has real data for).
 */
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: platformConfig.name,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Multi-tenant logistics operations platform for freight-forwarding, warehouse, air cargo, ocean freight, RoRo, and consolidation companies.',
  publisher: {
    '@type': 'Organization',
    name: platformConfig.companyName,
  },
};

const OWNER_SECTIONS = [
  {
    icon: IconGlobe,
    title: 'Owner Visibility',
    description:
      'See what is happening in your business without being at the warehouse — shipments, containers, payments, and staff activity, from wherever you are.',
  },
  {
    icon: IconHeadset,
    title: 'Customer Portal',
    description:
      'Customers see their own shipments, invoices, documents, and status updates, without calling your office for it.',
  },
  {
    icon: IconSearch,
    title: 'Barcode / Scanner Workflow',
    description:
      'Every item gets a scannable label at intake, and every scan afterward builds a permanent, accurate record.',
  },
  {
    icon: IconLayers,
    title: 'Analytics',
    description:
      'Revenue, shipment volume, and open exceptions in one view — the numbers an owner actually needs, not a data dump.',
  },
  {
    icon: IconCheckCircle,
    title: 'Payments & Invoicing',
    description:
      'Issue invoices tied to real shipments and accept payment online, or record it manually — either way, one ledger.',
  },
  {
    icon: IconMail,
    title: 'Notifications',
    description:
      'Customers are notified automatically at key milestones, by email and in-app, without staff having to remember to do it.',
  },
];

export default function AnanseLogixHomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }} />
      <section className="relative overflow-hidden bg-gradient-to-b from-primary-950 via-primary-900 to-primary-800 text-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <Container className="relative grid grid-cols-1 gap-12 py-20 lg:grid-cols-5 lg:items-center lg:gap-10 lg:py-24">
          <div className="max-w-2xl lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent-400">
              Multi-Tenant Logistics Operations Platform
            </p>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-5xl">
              Run Your Shipping Business From Anywhere
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-primary-100">
              AnanseLogix gives logistics companies one system to manage packages, warehouses, containers,
              manifests, customers, payments, tracking and staff — from receiving to final delivery.
            </p>
            <p className="mt-3 max-w-xl text-base text-primary-200">
              Know what is happening in your business without being at the warehouse.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <LinkButton href="/ananselogix/signup" variant="inverse" size="lg">
                Start Your Company
              </LinkButton>
              <LinkButton
                href="/ananselogix/how-it-works"
                variant="ghost"
                size="lg"
                className="border border-white/40 text-white hover:bg-white/10"
              >
                See How It Works
              </LinkButton>
            </div>
          </div>
          <div className="lg:col-span-3">
            <HeroDashboardMockup />
          </div>
        </Container>
      </section>

      <section className="py-20 lg:py-24">
        <Container>
          <SectionHeading
            eyebrow="Product Overview"
            title="Everything your operation touches, in one place"
            description="One system across receiving, warehouse, containers, manifests, customer communication, and billing — instead of a different tool (or spreadsheet) for each."
          />
          <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-center">
            <OwnerDashboardPreview />
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {OWNER_SECTIONS.map((item) => (
                <Card key={item.title}>
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-base font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.description}</p>
                </Card>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <section className="bg-slate-50 py-20 lg:py-24">
        <Container>
          <SectionHeading
            eyebrow="Operational Workflow"
            title="From receiving to final delivery"
            align="center"
          />
          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {workflowSteps.map((step, index) => (
              <div key={step.label} className="rounded-xl border border-slate-200 bg-white p-4 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary-700 text-white">
                  <step.icon className="h-4 w-4" />
                </span>
                <p className="mt-3 text-sm font-semibold text-slate-900">{step.label}</p>
                <p className="mt-0.5 text-[11px] font-medium text-slate-400">Step {index + 1}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-slate-500">
            Owner-level visibility runs through every step above — see{' '}
            <a href="/ananselogix/how-it-works" className="font-medium text-primary-700">
              How It Works
            </a>{' '}
            for the full picture.
          </p>
        </Container>
      </section>

      <section className="py-20 lg:py-24">
        <Container className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500/10 text-accent-600">
              <IconHeadset className="h-5 w-5" />
            </span>
            <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-slate-900">
              AI Training &amp; Support Agent
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              A built-in assistant that teaches your employees how to operate the system in plain language —
              &ldquo;How do I receive a package?&rdquo;, &ldquo;How do I create a manifest?&rdquo;, &ldquo;I just
              scanned this package, what do I do next?&rdquo; Answers are grounded in how AnanseLogix actually
              works, not generic advice.
            </p>
          </div>
          <AiAgentChatPreview />
        </Container>
      </section>

      <section className="bg-primary-950 py-16 text-center text-white">
        <Container>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent-400">Pricing</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Website only, software only, or both
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-primary-100">
            Straightforward plans for logistics companies of any size — see current pricing and what&rsquo;s
            included in each.
          </p>
          <div className="mt-8">
            <LinkButton href="/ananselogix/pricing" variant="inverse" size="lg">
              View Pricing
            </LinkButton>
          </div>
        </Container>
      </section>

      <CTASection
        eyebrow="See It In Action"
        title="Want a walkthrough first?"
        description="Tell us about your operation and we'll show you AnanseLogix running on a real workflow like yours."
        primaryHref="/ananselogix/demo"
        primaryLabel="Request a Demo"
        secondaryHref="/ananselogix/signup"
        secondaryLabel="Start Your Company"
      />
    </>
  );
}
