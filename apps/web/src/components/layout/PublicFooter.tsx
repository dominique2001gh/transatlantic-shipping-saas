import Link from 'next/link';
import { IconMail, IconMapPin, IconPhone } from '@/components/icons';
import { Container } from '@/components/ui/Container';
import { services } from '@/lib/services-data';
import { siteConfig } from '@/lib/site-config';

interface FooterLink {
  label: string;
  href: string;
}

const customerResourceLinks: FooterLink[] = [
  { label: 'Track Shipment', href: '/track' },
  { label: 'Request a Quote', href: '/quote' },
  { label: 'How It Works', href: '/how-it-works' },
];

const companyLinks: FooterLink[] = [
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

const accountLinks: FooterLink[] = [
  { label: 'Customer Login', href: '/login' },
  { label: 'Create Account', href: '/register' },
];

function FooterGroup({
  title,
  links,
  extraLink,
}: {
  title: string;
  links: FooterLink[];
  extraLink?: FooterLink;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-primary-400">{title}</h3>
      <ul className="mt-4 flex flex-col gap-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-sm text-primary-200 hover:text-white">
              {link.label}
            </Link>
          </li>
        ))}
        {extraLink && (
          <li>
            <Link href={extraLink.href} className="text-sm font-medium text-white hover:text-accent-400">
              {extraLink.label}
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-black/20 bg-primary-950 text-primary-200">
      <Container className="py-16">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-sm font-bold text-white">
                {siteConfig.initials}
              </span>
              <span className="font-display text-base font-semibold text-white">{siteConfig.shortName}</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-primary-300">{siteConfig.description}</p>
            <div className="mt-5 flex flex-col gap-2.5 text-sm text-primary-300">
              <a
                href={`mailto:${siteConfig.contact.email}`}
                className="flex items-center gap-2 hover:text-white"
              >
                <IconMail className="h-4 w-4 shrink-0" />
                {siteConfig.contact.email}
              </a>
              <a
                href={`tel:${siteConfig.contact.phoneHref}`}
                className="flex items-center gap-2 hover:text-white"
              >
                <IconPhone className="h-4 w-4 shrink-0" />
                {siteConfig.contact.phone}
              </a>
              {siteConfig.locations.map((location) => (
                <span key={location.label} className="flex items-center gap-2">
                  <IconMapPin className="h-4 w-4 shrink-0" />
                  {location.label} — {location.city}, {location.region}
                </span>
              ))}
            </div>
          </div>

          <FooterGroup
            title="Services"
            links={services.map((service) => ({ label: service.navLabel, href: `/services/${service.slug}` }))}
            extraLink={{ label: 'View all services', href: '/services' }}
          />
          <FooterGroup title="Customer Resources" links={customerResourceLinks} />
          <FooterGroup title="Company" links={companyLinks} />
          <FooterGroup title="Account" links={accountLinks} />
        </div>

        <div className="mt-12 border-t border-white/10 pt-6 text-xs text-primary-400">
          &copy; {new Date().getFullYear()} {siteConfig.companyName}. All rights reserved.
        </div>
      </Container>
    </footer>
  );
}
