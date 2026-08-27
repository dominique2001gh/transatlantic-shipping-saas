'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconClose, IconMenu } from '@/components/icons';
import { LinkButton } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { services } from '@/lib/services-data';
import { primaryNavLinks } from '@/lib/site-nav';
import { siteConfig } from '@/lib/site-config';

export function PublicHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);
  const [desktopServicesOpen, setDesktopServicesOpen] = useState(false);
  const servicesMenuRef = useRef<HTMLDivElement>(null);

  // Close everything whenever the route changes.
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

  const navLinkClass =
    'rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900';

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
      <Container className="flex items-center justify-between gap-4 py-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-700 text-sm font-bold text-white">
            {siteConfig.initials}
          </span>
          <span className="font-display text-base font-semibold text-slate-900">{siteConfig.shortName}</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          <Link href="/" className={navLinkClass}>
            Home
          </Link>

          <div className="relative" ref={servicesMenuRef}>
            <button
              type="button"
              className={`flex items-center gap-1 ${navLinkClass}`}
              aria-haspopup="true"
              aria-expanded={desktopServicesOpen}
              onClick={() => setDesktopServicesOpen((value) => !value)}
            >
              Services
              <IconChevronDown
                className={`h-4 w-4 transition-transform ${desktopServicesOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {desktopServicesOpen && (
              <div className="absolute left-1/2 top-full z-10 mt-2 w-72 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-2 shadow-lg animate-fade-in">
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
            .map((link) => (
              <Link key={link.href} href={link.href} className={navLinkClass}>
                {link.label}
              </Link>
            ))}
        </nav>

        <div className="hidden items-center gap-5 lg:flex">
          <Link href="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Customer Login
          </Link>
          <LinkButton href="/quote">Request a Quote</LinkButton>
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

      {mobileOpen && (
        <div className="border-t border-slate-200 px-4 pb-6 pt-2 lg:hidden">
          <nav className="flex flex-col" aria-label="Mobile">
            <Link
              href="/"
              className="rounded-md px-2 py-3 text-sm font-medium text-slate-700"
              onClick={() => setMobileOpen(false)}
            >
              Home
            </Link>

            <button
              type="button"
              className="flex items-center justify-between rounded-md px-2 py-3 text-left text-sm font-medium text-slate-700"
              aria-expanded={mobileServicesOpen}
              onClick={() => setMobileServicesOpen((value) => !value)}
            >
              Services
              <IconChevronDown
                className={`h-4 w-4 transition-transform ${mobileServicesOpen ? 'rotate-180' : ''}`}
              />
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
                <Link
                  href="/services"
                  className="rounded-md px-2 py-2.5 text-sm font-semibold text-primary-700"
                  onClick={() => setMobileOpen(false)}
                >
                  View all services
                </Link>
              </div>
            )}

            {primaryNavLinks
              .filter((link) => link.href !== '/')
              .map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-2 py-3 text-sm font-medium text-slate-700"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              ))}

            <Link
              href="/login"
              className="rounded-md px-2 py-3 text-sm font-medium text-slate-700"
              onClick={() => setMobileOpen(false)}
            >
              Customer Login
            </Link>
            <LinkButton href="/quote" className="mt-3 justify-center" onClick={() => setMobileOpen(false)}>
              Request a Quote
            </LinkButton>
          </nav>
        </div>
      )}
    </header>
  );
}
