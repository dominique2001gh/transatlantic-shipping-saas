import type { Metadata } from 'next';
import { IconMail, IconMapPin, IconPhone } from '@/components/icons';
import { ContactForm } from '@/components/forms/ContactForm';
import { PageHero } from '@/components/marketing/PageHero';
import { Container } from '@/components/ui/Container';
import { siteConfig } from '@/lib/site-config';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Contact Trans Atlantic Logistics Solutions.',
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        kicker="Contact"
        title="Get in touch with our team"
        description="Have a question about a shipment, or want a quote? Reach out and we'll respond as soon as we can."
      />
      <section className="py-20 lg:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <div className="flex flex-col gap-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                  <IconMail className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold text-slate-900">Email</h3>
                <a
                  href={`mailto:${siteConfig.contact.email}`}
                  className="mt-1 block text-sm text-primary-700 hover:underline"
                >
                  {siteConfig.contact.email}
                </a>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                  <IconPhone className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold text-slate-900">Phone</h3>
                <a
                  href={`tel:${siteConfig.contact.phoneHref}`}
                  className="mt-1 block text-sm text-primary-700 hover:underline"
                >
                  {siteConfig.contact.phone}
                </a>
              </div>
              {siteConfig.locations.map((location) => (
                <div key={location.label} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                    <IconMapPin className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-base font-semibold text-slate-900">{location.label}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {location.city}, {location.region}, {location.country}
                  </p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-card sm:p-10">
              <h2 className="font-display text-xl font-semibold text-slate-900">Send us a message</h2>
              <p className="mt-2 text-sm text-slate-600">Fill out the form and our team will get back to you.</p>
              <div className="mt-8">
                <ContactForm />
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
