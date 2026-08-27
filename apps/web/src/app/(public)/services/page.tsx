import type { Metadata } from 'next';
import { CTASection } from '@/components/marketing/CTASection';
import { PageHero } from '@/components/marketing/PageHero';
import { ServiceCard } from '@/components/marketing/ServiceCard';
import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { services } from '@/lib/services-data';

export const metadata: Metadata = {
  title: 'Services',
  description:
    'Ocean, air, and RoRo freight forwarding, backed by warehousing and consolidation, for cargo moving between the United States and destinations worldwide.',
};

const additionalCapabilities = [
  {
    title: 'Cross-Docking',
    description:
      'Cargo that needs to move straight through our warehouse to its next carrier without extended storage.',
  },
  {
    title: 'Drop-to-Door',
    description: 'Coordinated delivery from the destination warehouse to your final address.',
  },
  {
    title: 'Logistics & Supply Chain Support',
    description: 'Coordination across freight modes for shippers with recurring or multi-part shipments.',
  },
];

export default function ServicesPage() {
  return (
    <>
      <PageHero
        kicker="Services"
        title="Freight and logistics services for every shipment"
        description="Ocean, air, and RoRo freight forwarding, backed by warehousing and consolidation, for cargo moving between the United States and destinations worldwide."
      />

      <section className="py-20 lg:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <ServiceCard key={service.slug} service={service} />
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-slate-200 bg-slate-50 py-20 lg:py-24">
        <Container>
          <SectionHeading
            eyebrow="Additional capabilities"
            title="More ways we support your shipment"
            description="Beyond core freight services, we support the logistics around your shipment too."
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {additionalCapabilities.map((item) => (
              <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
                <h3 className="font-display text-base font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.description}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <CTASection
        eyebrow="Get started"
        title="Not sure which service fits your shipment?"
        description="Tell us what you're shipping and where it's going — we'll recommend the right option."
        primaryHref="/quote"
        primaryLabel="Request a Quote"
        secondaryHref="/contact"
        secondaryLabel="Talk to Our Team"
      />
    </>
  );
}
