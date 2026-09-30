import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { isAnanseLogixHostname } from '@/lib/ananselogix-hostname';
import { platformConfig } from '@/lib/platform-config';
import PlatformLayoutClient from './PlatformLayoutClient';

/**
 * Multi-tenant branding fix: same gap and same fix shape as
 * (public)/layout.tsx, portal/layout.tsx, and dashboard/layout.tsx (see
 * each file's own doc comment) — /platform fell straight through to the
 * root layout's static Trans Atlantic title regardless of hostname, even
 * though /platform is AnanseLogix's own internal admin console (Ananse
 * Automation staff managing every tenant) and has never been Trans
 * Atlantic's, or any one tenant's, in the first place — its own visible
 * sidebar branding already reads platformConfig.name unconditionally
 * (see PlatformLayoutClient.tsx), with no tenant/hostname branching at
 * all. That's why this file is simpler than portal/dashboard's own
 * equivalents: there is no tenant-specific layer to add on top — /platform
 * is never tenant-specific, by design, so the correct browser title is
 * always just the platform's own, no useTenant() involved.
 *
 * Still hostname-conditional (not an unconditional platformConfig title)
 * for the same reason as its siblings: to guarantee zero behavior change
 * on Trans Atlantic's own hostnames, byte-for-byte, rather than assume
 * nothing depends on the prior default there.
 */
export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host');
  if (!isAnanseLogixHostname(host)) {
    return {}; // Trans Atlantic (or any other hostname): no override, root layout's own default applies unchanged
  }

  return {
    title: { absolute: `${platformConfig.name} · Platform Admin` },
    description: platformConfig.tagline,
    openGraph: {
      type: 'website',
      siteName: platformConfig.name,
      title: `${platformConfig.name} · Platform Admin`,
      description: platformConfig.tagline,
    },
    twitter: {
      card: 'summary',
      title: `${platformConfig.name} · Platform Admin`,
    },
  };
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformLayoutClient>{children}</PlatformLayoutClient>;
}
