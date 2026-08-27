import { IconWarehouse } from '@/components/icons';
import { CargoTypesGrid } from '@/components/marketing/CargoTypesGrid';
import { CTASection } from '@/components/marketing/CTASection';
import { Hero } from '@/components/marketing/Hero';
import { PhotoPlaceholder } from '@/components/marketing/PhotoPlaceholder';
import { ProcessTimeline } from '@/components/marketing/ProcessTimeline';
import { ServiceCard } from '@/components/marketing/ServiceCard';
import { ValuePropsGrid } from '@/components/marketing/ValuePropsGrid';
import { LinkButton } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { TrackingForm } from '@/components/forms/TrackingForm';
import { homeProcessSteps } from '@/lib/process-data';
import { services } from '@/lib/services-data';

export default function HomePage() {
  return (
    <>
      <Hero />

      {/* Services */}
      <section className="py-20 lg:py-24">
        <Container>
          <SectionHeading
            eyebrow="What we move"
            title="Freight services built around your cargo"
            description="Choose the right service for what you're shipping — or combine them as part of one shipment."
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <ServiceCard key={service.slug} service={service} />
            ))}
          </div>
        </Container>
      </section>

      {/* Why Trans Atlantic */}
      <section className="border-t border-slate-200 bg-slate-50 py-20 lg:py-24">
        <Container>
          <SectionHeading
            eyebrow="Why ship with us"
            title="Why Trans Atlantic Logistics Solutions"
            description="A freight forwarding partner built around visibility, flexibility, and a team that stays involved after your shipment leaves the warehouse."
          />
          <div className="mt-12">
            <ValuePropsGrid />
          </div>
        </Container>
      </section>

      {/* How Shipping Works */}
      <section className="py-20 lg:py-24">
        <Container>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading
              eyebrow="The process"
              title="How shipping works"
              description="From the moment you request a shipment to the moment it's delivered, here's what to expect."
            />
            <LinkButton href="/how-it-works" variant="secondary" className="shrink-0">
              See the full process
            </LinkButton>
          </div>
          <div className="mt-12">
            <ProcessTimeline steps={homeProcessSteps} />
          </div>
        </Container>
      </section>

      {/* What We Ship */}
      <section className="border-t border-slate-200 bg-slate-50 py-20 lg:py-24">
        <Container>
          <SectionHeading
            eyebrow="What we ship"
            title="Built for every kind of cargo"
            description="From a single barrel to commercial machinery, our warehouse and freight network is built to handle it."
            align="center"
          />
          <div className="mt-12">
            <CargoTypesGrid />
          </div>
        </Container>
      </section>

      {/* Tracking */}
      <section className="py-20 lg:py-24">
        <Container>
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionHeading
                eyebrow="Stay informed"
                title="Track your shipment anytime"
                description="Enter your tracking number to check on your shipment's status, from warehouse receipt to final delivery."
              />
              <div className="mt-8 max-w-lg">
                <TrackingForm />
              </div>
            </div>
            <PhotoPlaceholder icon={IconWarehouse} label="Warehouse operations" tone="slate" />
          </div>
        </Container>
      </section>

      {/* Quote CTA */}
      <CTASection
        eyebrow="Get started"
        title="Ready to ship with Trans Atlantic?"
        description="Tell us about your shipment and our team will follow up with a quote tailored to what you're moving."
        primaryHref="/quote"
        primaryLabel="Request a Quote"
        secondaryHref="/contact"
        secondaryLabel="Talk to Our Team"
      />
    </>
  );
}
