import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { isAnanseLogixHostname } from '@/lib/ananselogix-hostname';
import { platformConfig } from '@/lib/platform-config';
import DashboardLayoutClient from './DashboardLayoutClient';

/**
 * Multi-tenant branding fix: same gap and same fix shape as
 * (public)/layout.tsx and portal/layout.tsx (see each file's own doc
 * comment) — /dashboard is authenticated, client-rendered content, so
 * this only ever provides the *default* title (generic AnanseLogix on
 * ananselogix.com, Trans Atlantic's own unchanged everywhere else); the
 * real, tenant-specific title ("Gold Coast — Staff Console") is set
 * client-side once useTenant() resolves — see DashboardLayoutClient.tsx's
 * own doc comment. Favicon is unaffected by this file — see
 * DashboardLayoutClient's pre-existing useTenantFaviconOverride and
 * brand-icon.ts's own doc comment for why the app-root icon.tsx/
 * apple-icon.tsx already resolve correctly by Host with no change needed
 * here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host');
  if (!isAnanseLogixHostname(host)) {
    return {}; // Trans Atlantic (or any other hostname): no override, root layout's own default applies unchanged
  }

  return {
    title: { absolute: `${platformConfig.name} · Staff Console` },
    description: platformConfig.tagline,
    openGraph: {
      type: 'website',
      siteName: platformConfig.name,
      title: `${platformConfig.name} · Staff Console`,
      description: platformConfig.tagline,
    },
    twitter: {
      card: 'summary',
      title: `${platformConfig.name} · Staff Console`,
    },
  };
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}
