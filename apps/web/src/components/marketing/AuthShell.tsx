import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconShip } from '@/components/icons';
import { platformConfig } from '@/lib/platform-config';
import { siteConfig } from '@/lib/site-config';
import type { BrandIconVariant } from '@/lib/brand-icon';

/**
 * Multi-tenant branding fix (2026-09): which brand this shell renders —
 * defaults to 'trans-atlantic' (today's exact prior behavior, unchanged)
 * so /login, /register, /forgot-password, /reset-password — every
 * existing caller that doesn't pass this — keep rendering exactly as
 * before. /accept-invite is the one caller that resolves and passes this
 * explicitly (via the same resolveBrandIconVariant this app already uses
 * for favicons — see brand-icon.ts's own doc comment), since it's the
 * only auth-shell page reachable from a hostname that doesn't belong to
 * whichever tenant happens to be Tenant #1. A tenant's own real branded
 * activation experience (once Tenant.customDomain-driven per-tenant
 * branding exists, not just this brand-level fork) is a further layer on
 * top of this same prop, not a redesign of it.
 */
export type AuthShellBrand = BrandIconVariant;

const BRAND_CONTENT: Record<
  AuthShellBrand,
  { logoSrc: string | null; logoAlt: string; name: string; companyName: string; tagline: string; description: string }
> = {
  'trans-atlantic': {
    logoSrc: '/trans-atlantic-logo.png',
    logoAlt: 'Trans Atlantic Logistics Solutions logo',
    name: siteConfig.shortName,
    companyName: siteConfig.companyName,
    tagline: 'Your shipments, tracked from warehouse to doorstep.',
    description: 'Sign in to view shipment status, invoices, and documents in one place.',
  },
  // No AnanseLogix logo asset exists yet (platformConfig.logoSrc is still
  // null — "TBD, not yet designed") — text + the same generic ship icon
  // every tenant's own panel already uses, never any tenant's own logo.
  ananselogix: {
    logoSrc: platformConfig.logoSrc,
    logoAlt: `${platformConfig.name} logo`,
    name: platformConfig.name,
    companyName: platformConfig.companyName,
    tagline: 'One platform for freight forwarders to run their whole operation.',
    description: 'Sign in or activate your account to get started.',
  },
};

/**
 * Split-screen shell shared by /login, /register, /forgot-password,
 * /reset-password, and /accept-invite — a branded panel on the left
 * (hidden on small screens) and the auth form on the right, so signing in
 * feels like entering a real shipping portal rather than a bare form
 * page.
 */
export function AuthShell({ children, brand = 'trans-atlantic' }: { children: ReactNode; brand?: AuthShellBrand }) {
  const content = BRAND_CONTENT[brand];

  return (
    <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
            backgroundSize: '3rem 3rem',
          }}
        />
        <Link href="/" className="relative flex items-center gap-2.5 text-white">
          {content.logoSrc && (
            <Image src={content.logoSrc} alt={content.logoAlt} width={36} height={36} className="h-9 w-9 shrink-0 object-contain" />
          )}
          <span className="font-display text-base font-semibold">{content.name}</span>
        </Link>
        <div className="relative">
          <IconShip className="h-12 w-12 text-accent-400" />
          <h2 className="mt-6 max-w-sm font-display text-2xl font-semibold text-white">{content.tagline}</h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-primary-200">{content.description}</p>
        </div>
        <p className="relative text-xs text-primary-400">
          &copy; {new Date().getFullYear()} {content.companyName}
        </p>
      </div>

      <div className="flex flex-col justify-center px-6 py-16 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            {content.logoSrc && (
              <Image src={content.logoSrc} alt={content.logoAlt} width={36} height={36} className="h-9 w-9 shrink-0 object-contain" />
            )}
            <span className="font-display text-base font-semibold text-slate-900">{content.name}</span>
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
