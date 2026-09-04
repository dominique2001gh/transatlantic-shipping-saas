import type { Metadata } from 'next';
import Image from 'next/image';
import { CTASection } from '@/components/marketing/CTASection';
import { PageHero } from '@/components/marketing/PageHero';
import { ValuePropsGrid } from '@/components/marketing/ValuePropsGrid';
import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';

export const metadata: Metadata = {
  title: 'About',
  description: 'About Trans Atlantic Logistics Solutions.',
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        kicker="About Us"
        title="A freight forwarding partner for international shipping"
        description="Trans Atlantic Logistics Solutions moves cargo by ocean, air, and RoRo freight for businesses and individuals shipping between the United States and destinations worldwide."
      />

      <section className="py-20 lg:py-24">
        <Container>
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionHeading eyebrow="What we do" title="Freight forwarding, coordinated end to end" />
              <p className="mt-6 text-base leading-relaxed text-slate-600">
                We coordinate the movement of cargo from origin to destination — combining ocean, air, and
                RoRo freight with warehousing, consolidation, and shipment tracking under one account.
                Whether you&apos;re shipping a single barrel or commercial freight, our team helps you choose
                the right service and keeps you informed along the way.
              </p>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                Our origin warehouse handles receiving, measurement, and consolidation before cargo is
                booked onto its ocean, air, or RoRo service — with support for cross-docking and
                drop-to-door delivery once it arrives at destination.
              </p>
            </div>
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl shadow-xl">
              <Image
                src="/about-international-logistics.jpg"
                alt="Aerial view of an international container port with cranes, stacked containers, and vessels at berth"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover object-center"
              />
            </div>
          </div>
        </Container>
      </section>

      <section className="border-t border-slate-200 bg-slate-50 py-20 lg:py-24">
        <Container>
          <SectionHeading
            eyebrow="What we focus on"
            title="Built around flexibility and visibility"
            align="center"
          />
          <div className="mt-12">
            <ValuePropsGrid />
          </div>
        </Container>
      </section>

      <CTASection
        eyebrow="Get started"
        title="Ready to work with our team?"
        description="Request a quote or reach out with questions about your shipment."
        primaryHref="/quote"
        primaryLabel="Request a Quote"
        secondaryHref="/contact"
        secondaryLabel="Contact Us"
      />
    </>
  );
}
