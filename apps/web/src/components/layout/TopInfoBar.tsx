import Link from 'next/link';
import type { ComponentType } from 'react';
import { IconFacebook, IconInstagram, IconLinkedIn, IconWhatsApp } from '@/components/icons';
import type { IconProps } from '@/components/icons';
import { Container } from '@/components/ui/Container';
import { siteConfig } from '@/lib/site-config';

interface SocialPlatform {
  label: string;
  url: string | null;
  icon: ComponentType<IconProps>;
}

const socialPlatforms: SocialPlatform[] = [
  { label: 'Facebook', url: siteConfig.socialLinks.facebook, icon: IconFacebook },
  { label: 'LinkedIn', url: siteConfig.socialLinks.linkedin, icon: IconLinkedIn },
  { label: 'WhatsApp', url: siteConfig.socialLinks.whatsapp, icon: IconWhatsApp },
  { label: 'Instagram', url: siteConfig.socialLinks.instagram, icon: IconInstagram },
];

/**
 * Thin utility bar above the main header — approved homepage redesign,
 * tier 1 of 3 (see PublicHeader). Not sticky; scrolls away with the rest
 * of the page, leaving the main header + nav (which are sticky) as the
 * persistent chrome.
 *
 * Social icons: a real link renders only when siteConfig.socialLinks has
 * a real URL for that platform — none do today (all `null`), so every
 * icon currently renders as an inert, non-navigating placeholder
 * (aria-disabled, no href) rather than link to a guessed URL. Fill in
 * siteConfig.socialLinks once the real profile URLs are confirmed and
 * these become live links with no other changes needed.
 */
export function TopInfoBar() {
  return (
    <div className="hidden border-b border-primary-100 bg-primary-50/60 sm:block">
      <Container className="flex items-center justify-between gap-4 py-2 text-xs text-slate-600">
        <p>
          <span className="font-semibold text-slate-900">Shipping to Ghana and Beyond</span>
          <span className="mx-2 text-primary-200">|</span>
          Fast. Secure. Affordable.
        </p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 border-r border-primary-200 pr-4">
            {socialPlatforms.map((platform) => {
              const Icon = platform.icon;
              if (platform.url) {
                return (
                  <a
                    key={platform.label}
                    href={platform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={platform.label}
                    className="text-slate-500 hover:text-primary-700"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </a>
                );
              }
              return (
                <span
                  key={platform.label}
                  aria-disabled="true"
                  aria-label={`${platform.label} (link not yet configured)`}
                  title={`${platform.label} — URL not yet configured`}
                  className="text-slate-300"
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
              );
            })}
          </div>
          <nav className="flex items-center gap-4 font-medium" aria-label="Utility">
            <Link href="/login" className="hover:text-primary-700">
              Customer Portal
            </Link>
            <span className="text-primary-200">|</span>
            <Link href="/track" className="hover:text-primary-700">
              Track Shipment
            </Link>
          </nav>
        </div>
      </Container>
    </div>
  );
}
