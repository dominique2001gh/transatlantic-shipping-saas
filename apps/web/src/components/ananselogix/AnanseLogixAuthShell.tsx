import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconContainer } from '@/components/icons';
import { platformConfig } from '@/lib/platform-config';

/**
 * The central AnanseLogix login's own shell — deliberately NOT AuthShell
 * (that component is Trans Atlantic-hardcoded: its logo image, shortName,
 * and "your shipments, tracked" copy all come from siteConfig). This one
 * reads only platformConfig, the same brand-boundary rule
 * AnanseLogixHeader/Footer already establish, so this page can never
 * regress into showing tenant branding. No logo image — platformConfig.
 * logoSrc is null (not yet designed, see that file's own comment) — a
 * simple wordmark stands in, same treatment AnanseLogixHeader already uses.
 */
export function AnanseLogixAuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
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
        <Link href="/ananselogix" className="relative flex items-center gap-2.5 text-white">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
            <IconContainer className="h-5 w-5" />
          </span>
          <span className="font-display text-base font-semibold">{platformConfig.name}</span>
        </Link>
        <div className="relative">
          <h2 className="max-w-sm font-display text-2xl font-semibold text-white">Run your shipping business from anywhere.</h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-primary-200">
            One account, every tenant company you manage — sign in and we&apos;ll take you straight to the right
            place.
          </p>
        </div>
        <p className="relative text-xs text-primary-400">
          &copy; {new Date().getFullYear()} {platformConfig.companyName}
        </p>
      </div>

      <div className="flex flex-col justify-center bg-white px-6 py-16 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/ananselogix" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-700 text-white">
              <IconContainer className="h-5 w-5" />
            </span>
            <span className="font-display text-base font-semibold text-slate-900">{platformConfig.name}</span>
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
