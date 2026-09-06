'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IconClose, IconContainer, IconMenu } from '@/components/icons';
import { LinkButton } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { ananseLogixNavLinks } from '@/lib/ananselogix/site-nav';
import { platformConfig } from '@/lib/platform-config';

/**
 * AnanseLogix's own marketing-site header — deliberately separate from
 * PublicHeader (Trans Atlantic's tenant-branded header). Reads only
 * platformConfig, never siteConfig — see platform-config.ts's own doc
 * comment on why the two brand surfaces must never cross.
 */
export function AnanseLogixHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white">
      <Container className="flex items-center justify-between gap-6 py-4">
        <Link href="/ananselogix" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-700 text-white">
            <IconContainer className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold text-slate-900">{platformConfig.name}</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {ananseLogixNavLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                pathname === link.href ? 'text-primary-700' : 'text-slate-600 hover:text-primary-700'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/ananselogix/login" className="text-sm font-medium text-slate-600 hover:text-primary-700">
            Log In
          </Link>
          <LinkButton href="/ananselogix/signup" size="md">
            Start Your Company
          </LinkButton>
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
        <div className="border-t border-slate-200 bg-white px-4 pb-6 pt-2 lg:hidden">
          <nav className="flex flex-col" aria-label="Mobile">
            {ananseLogixNavLinks.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-md px-2 py-3 text-sm font-medium text-slate-700">
                {link.label}
              </Link>
            ))}
            <Link href="/ananselogix/login" className="rounded-md px-2 py-3 text-sm font-medium text-slate-700">
              Log In
            </Link>
            <LinkButton href="/ananselogix/signup" className="mt-3 justify-center">
              Start Your Company
            </LinkButton>
          </nav>
        </div>
      )}
    </header>
  );
}
