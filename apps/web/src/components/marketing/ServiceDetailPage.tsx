import { IconCheckCircle } from '@/components/icons';
import { CTASection } from '@/components/marketing/CTASection';
import { PageHero } from '@/components/marketing/PageHero';
import { PhotoPlaceholder } from '@/components/marketing/PhotoPlaceholder';
import { LinkButton } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { SectionHeading } from '@/components/ui/SectionHeading';
import type { ServiceContent } from '@/lib/services-data';

/**
 * Shared presentation for every /services/[slug] page — each route just
 * supplies its ServiceContent from lib/services-data.ts. Keeps the five
 * service pages visually and structurally consistent without duplicating
 * markup five times.
 */
export function ServiceDetailPage({ service }: { service: ServiceContent }) {
  const Icon = service.icon;

  return (
    <>
      <PageHero kicker={service.heroKicker} title={service.heroHeadline} description={service.heroDescription}>
        <div className="mt-8 flex flex-wrap gap-4">
          <LinkButton href="/quote" variant="inverse" size="lg">
            Request a Quote
          </LinkButton>
          <LinkButton
            href="/how-it-works"
            variant="ghost"
            size="lg"
            className="border border-white/30 text-white hover:bg-white/10"
          >
            See How Shipping Works
          </LinkButton>
        </div>
      </PageHero>

      <section className="py-20 lg:py-24">
        <Container>
          <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionHeading eyebrow="Common use cases" title={`Who uses ${service.name.toLowerCase()}`} />
              <ul className="mt-8 flex flex-col gap-4">
                {service.useCases.map((useCase) => (
                  <li key={useCase} className="flex items-start gap-3">
                    <IconCheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-600" />
                    <span className="text-sm leading-relaxed text-slate-700">{useCase}</span>
                  </li>
                ))}
              </ul>
            </div>
            <PhotoPlaceholder icon={Icon} label={service.name} tone="navy" />
          </div>
        </Container>
      </section>

      <section className="border-t border-slate-200 bg-slate-50 py-20 lg:py-24">
        <Container>
          <SectionHeading eyebrow="The process" title="How it works" align="center" />
          <ol className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {service.howItWorks.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
                <span className="font-display text-sm font-semibold text-primary-300">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-3 font-display text-base font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.description}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="py-20 lg:py-24">
        <Container>
          <SectionHeading eyebrow="Benefits" title={`Why choose our ${service.name.toLowerCase()}`} />
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {service.benefits.map((benefit) => (
              <li
                key={benefit}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card"
              >
                <IconCheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-600" />
                <span className="text-sm leading-relaxed text-slate-700">{benefit}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <CTASection
        eyebrow="Get started"
        title={`Ready to ship with ${service.name}?`}
        description="Tell us about your shipment and our team will follow up with a quote tailored to your cargo."
        primaryHref="/quote"
        primaryLabel="Request a Quote"
        secondaryHref="/contact"
        secondaryLabel="Talk to Our Team"
      />
    </>
  );
}
