import type { Metadata } from 'next';
import { platformConfig } from '@/lib/platform-config';
import { fetchPublicSiteConfig } from '@/lib/public-site-config';
import { TenantDropoffPageClient } from './TenantDropoffPageClient';

/**
 * Multi-tenant Drop-Off: thin Server Component wrapper around
 * TenantDropoffPageClient.tsx (see that file's own doc comment for why
 * the interactive page itself is a separate client component, and for
 * everything about this route's behavior/history). This file's only job
 * is `generateMetadata` — a page-level export only a Server Component can
 * provide — so the browser tab title and Open Graph/Twitter preview cards
 * show this specific tenant's own name (Gold Coast, Titanic, or any
 * future tenant), never Trans Atlantic's (the root layout's own default —
 * see that file's own doc comment for the sibling fix to the same
 * underlying gap) and never a hardcoded tenant name: `params.tenantSlug`
 * drives a real lookup against GET /public/site-config/:slug every time.
 *
 * A slug with no public site configured (fetchPublicSiteConfig 404s, or
 * the network call itself fails) falls back to the generic AnanseLogix
 * platform title, never Trans Atlantic's and never a crash — this route
 * must always render something reasonable for the customer even when
 * per-tenant branding data doesn't exist yet.
 */
export async function generateMetadata({ params }: { params: Promise<{ tenantSlug: string }> }): Promise<Metadata> {
  const { tenantSlug } = await params;
  // `title: { absolute: ... }`, not a plain string: a plain string title is
  // template-composable, so the enclosing (public) layout's own
  // `%s · AnanseLogix` template would still append onto it (e.g. "Prepare
  // Your Drop-Off — AnanseLogix · AnanseLogix") — this page already builds
  // its own complete, final title, so it must opt out of that chain.
  const fallback: Metadata = {
    title: { absolute: `Prepare Your Drop-Off — ${platformConfig.name}` },
    description: `Prepare your shipment drop-off online before you arrive at the warehouse.`,
    openGraph: {
      type: 'website',
      siteName: platformConfig.name,
      title: `Prepare Your Drop-Off — ${platformConfig.name}`,
    },
  };

  try {
    const config = await fetchPublicSiteConfig(tenantSlug);
    return {
      title: { absolute: `Prepare Your Drop-Off — ${config.companyName}` },
      description: `Prepare your shipment drop-off with ${config.companyName} online before you arrive at the warehouse.`,
      openGraph: {
        type: 'website',
        siteName: config.companyName,
        title: `Prepare Your Drop-Off — ${config.companyName}`,
        description: `Prepare your shipment drop-off with ${config.companyName} online before you arrive at the warehouse.`,
      },
      twitter: {
        card: 'summary',
        title: `Prepare Your Drop-Off — ${config.companyName}`,
      },
    };
  } catch {
    // No public site configured for this slug yet (404) or the lookup
    // failed — fall back to the generic platform title. Never Trans
    // Atlantic's, and never an error surfaced to the visitor.
    return fallback;
  }
}

export default function TenantDropoffPage() {
  return <TenantDropoffPageClient />;
}
