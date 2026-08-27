import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconShip } from '@/components/icons';
import { siteConfig } from '@/lib/site-config';

/**
 * Split-screen shell shared by /login and /register — a branded panel on
 * the left (hidden on small screens) and the auth form on the right, so
 * signing in feels like entering a real shipping portal rather than a
 * bare form page.
 */
export function AuthShell({ children }: { children: ReactNode }) {
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
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-sm font-bold">
            {siteConfig.initials}
          </span>
          <span className="font-display text-base font-semibold">{siteConfig.shortName}</span>
        </Link>
        <div className="relative">
          <IconShip className="h-12 w-12 text-accent-400" />
          <h2 className="mt-6 max-w-sm font-display text-2xl font-semibold text-white">
            Your shipments, tracked from warehouse to doorstep.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-primary-200">
            Sign in to view shipment status, invoices, and documents in one place.
          </p>
        </div>
        <p className="relative text-xs text-primary-400">
          &copy; {new Date().getFullYear()} {siteConfig.companyName}
        </p>
      </div>

      <div className="flex flex-col justify-center px-6 py-16 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-700 text-sm font-bold text-white">
              {siteConfig.initials}
            </span>
            <span className="font-display text-base font-semibold text-slate-900">{siteConfig.shortName}</span>
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
