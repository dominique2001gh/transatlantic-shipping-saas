'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  IconChevronDown,
  IconClose,
  IconMail,
  IconMapPin,
  IconMenu,
  IconPhone,
} from '@/components/icons';
import { LinkButton } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { TopInfoBar } from '@/components/layout/TopInfoBar';
import { services } from '@/lib/services-data';
import { primaryNavLinks } from '@/lib/site-nav';
import { siteConfig } from '@/lib/site-config';

/**
 * Approved homepage redesign — site-wide header, tiers 2 + 3 of 3
 * (tier 1 is TopInfoBar, rendered above this). Applies to every public
 * page via PublicLayout, not just the homepage — a nav that changed
 * per-page would be inconsistent, and this is the same header the
 * approved design shows on the homepage.
 *
 * Tier 2: white header — logo mark, company name, and contact blocks
 * (phone/email/primary location), all sourced from siteConfig so no
 * contact detail is hard-coded here.
 * Tier 3: dark navy primary nav — page links (see lib/site-nav.ts for
 * the label -> existing-route mapping) plus the Services dropdown
 * (unchanged mechanism from before this redesign) and a prominent
 * "Track Shipment" button.
 *
 * Both tiers are sticky together (top bar is not — it scrolls away),
 * so branding + navigation stay visible while contact-block clutter
 * doesn't compete for space once scrolled.
 */
export function PublicHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);
  const [desktopServicesOpen, setDesktopServicesOpen] = useState(false);
  const servicesMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
    setDesktopServicesOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (servicesMenuRef.current && !servicesMenuRef.current.contains(event.target as Node)) {
        setDesktopServicesOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDesktopServicesOpen(false);
        setMobileOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const navLinkClass = 'px-3 py-2 text-sm font-medium text-primary-100 transition-colors hover:text-white';

  return (
    <header className="sticky top-0 z-50">
      <TopInfoBar />

      {/* Tier 2: white header — logo + contact blocks */}
      <div className="border-b border-slate-200 bg-white">
        <Container className="flex items-center justify-between gap-6 py-4">
          <Link href="/" className="flex shrink-0 items-center gap-3">
            <Image
              src="/trans-atlantic-logo.png"
              alt="Trans Atlantic Logistics Solutions logo"
              width={56}
              height={56}
              priority
              className="h-14 w-14 shrink-0 object-contain"
            />
            <span className="flex flex-col">
              <span className="font-display text-lg font-bold leading-tight text-slate-900 sm:text-xl">
                {siteConfig.shortName}
              </span>
              <span className="text-xs font-medium text-slate-500">Logistics Solutions</span>
            </span>
          </Link>

          <div className="hidden items-center gap-8 lg:flex">
            <div className="flex items-center gap-2.5 text-sm">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <IconPhone className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs text-slate-500">Call Us</p>
                <a href={`tel:${siteConfig.contact.phoneHref}`} className="font-semibold text-slate-900 hover:text-primary-700">
                  {siteConfig.contact.phone}
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                <IconMail className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs text-slate-500">Email Us</p>
                <a href={`mailto:${siteConfig.contact.email}`} className="font-semibold text-slate-900 hover:text-primary-700">
                  {siteConfig.contact.email}
                </a>
              </div>
            </div>
            {siteConfig.locations[0] && (
              <div className="flex items-center gap-2.5 text-sm">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                  <IconMapPin className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs text-slate-500">Our Location</p>
                  <p className="font-semibold text-slate-900">
                    {siteConfig.locations[0].city}, {siteConfig.locations[0].region}
                  </p>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-2 text-slate-600 lg:hidden"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <IconClose className="h-6 w-6" /> : <IconMenu className="h-6 w-6" />}
          </button>
        </Container>
      </div>

      {/* Tier 3: dark navy primary nav */}
      <div className="hidden bg-primary-950 lg:block">
        <Container className="flex items-center justify-between gap-4">
          <nav className="flex items-center" aria-label="Primary">
            <Link href="/" className={navLinkClass}>
              Home
            </Link>
            {primaryNavLinks
              .filter((link) => link.href !== '/')
              .slice(0, 1)
              .map((link) => (
                <Link key={link.href} href={link.href} className={navLinkClass}>
                  {link.label}
                </Link>
              ))}

            <div className="relative" ref={servicesMenuRef}>
              <button
                type="button"
                className={`flex items-center gap-1 ${navLinkClass}`}
                aria-haspopup="true"
                aria-expanded={desktopServicesOpen}
                onClick={() => setDesktopServicesOpen((value) => !value)}
              >
                Our Services
                <IconChevronDown className={`h-4 w-4 transition-transform ${desktopServicesOpen ? 'rotate-180' : ''}`} />
              </button>
              {desktopServicesOpen && (
                <div className="absolute left-0 top-full z-10 mt-0 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg animate-fade-in">
                  {services.map((service) => {
                    const Icon = service.icon;
                    return (
                      <Link
                        key={service.slug}
                        href={`/services/${service.slug}`}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                        onClick={() => setDesktopServicesOpen(false)}
                      >
                        <Icon className="h-5 w-5 text-primary-700" />
                        {service.navLabel}
                      </Link>
                    );
                  })}
                  <Link
                    href="/services"
                    className="mt-1 flex items-center gap-2 rounded-lg border-t border-slate-100 px-3 py-2.5 text-sm font-semibold text-primary-700 hover:bg-slate-50"
                    onClick={() => setDesktopServicesOpen(false)}
                  >
                    View all services
                  </Link>
                </div>
              )}
            </div>

            {primaryNavLinks
              .filter((link) => link.href !== '/')
              .slice(1)
              .map((link) => (
                <Link key={link.label} href={link.href} className={navLinkClass}>
                  {link.label}
                </Link>
              ))}
          </nav>

          <LinkButton href="/track" className="my-2.5 shrink-0 !bg-primary-500 !text-white hover:!bg-primary-400">
            Track Shipment
          </LinkButton>
        </Container>
      </div>

      {mobileOpen && (
        <div className="border-t border-slate-200 bg-white px-4 pb-6 pt-2 lg:hidden">
          <nav className="flex flex-col" aria-label="Mobile">
            <Link href="/" className="rounded-md px-2 py-3 text-sm font-medium text-slate-700" onClick={() => setMobileOpen(false)}>
              Home
            </Link>

            <button
              type="button"
              className="flex items-center justify-between rounded-md px-2 py-3 text-left text-sm font-medium text-slate-700"
              aria-expanded={mobileServicesOpen}
              onClick={() => setMobileServicesOpen((value) => !value)}
            >
              Our Services
              <IconChevronDown className={`h-4 w-4 transition-transform ${mobileServicesOpen ? 'rotate-180' : ''}`} />
            </button>
            {mobileServicesOpen && (
              <div className="ml-2 flex flex-col border-l border-slate-200 pl-3">
                {services.map((service) => (
                  <Link
                    key={service.slug}
                    href={`/services/${service.slug}`}
                    className="rounded-md px-2 py-2.5 text-sm text-slate-600"
                    onClick={() => setMobileOpen(false)}
                  >
                    {service.navLabel}
                  </Link>
                ))}
                <Link href="/services" className="rounded-md px-2 py-2.5 text-sm font-semibold text-primary-700" onClick={() => setMobileOpen(false)}>
                  View all services
                </Link>
              </div>
            )}

            {primaryNavLinks
              .filter((link) => link.href !== '/')
              .map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="rounded-md px-2 py-3 text-sm font-medium text-slate-700"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              ))}

            <div className="mt-3 flex flex-col gap-2.5 border-t border-slate-100 pt-4 text-sm text-slate-600">
              <a href={`tel:${siteConfig.contact.phoneHref}`} className="flex items-center gap-2">
                <IconPhone className="h-4 w-4 text-primary-700" />
                {siteConfig.contact.phone}
              </a>
              <a href={`mailto:${siteConfig.contact.email}`} className="flex items-center gap-2">
                <IconMail className="h-4 w-4 text-primary-700" />
                {siteConfig.contact.email}
              </a>
            </div>

            <LinkButton href="/track" className="mt-4 justify-center" onClick={() => setMobileOpen(false)}>
              Track Shipment
            </LinkButton>
          </nav>
        </div>
      )}
    </header>
  );
}
