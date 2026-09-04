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
  /**
   * Strong brand color, applied to the icon whether it's clickable or
   * still inert — disabled state is communicated via cursor/tooltip/ARIA
   * on the inert span, not by washing the icon out to gray. See
   * IconBase in components/icons.tsx: these are single-color
   * stroke="currentColor" outline icons (no fill regions), so a true
   * multi-stop Instagram gradient isn't achievable without reworking
   * the shared icon component — Instagram uses a strong solid magenta
   * instead, same as Facebook/LinkedIn/WhatsApp get a solid brand color.
   */
  brandClassName: string;
  /** Extra hover treatment, only applied once the platform is clickable. */
  hoverClassName?: string;
}

const socialPlatforms: SocialPlatform[] = [
  { label: 'Facebook', url: siteConfig.socialLinks.facebook, icon: IconFacebook, brandClassName: 'text-[#1877F2]' },
  { label: 'LinkedIn', url: siteConfig.socialLinks.linkedin, icon: IconLinkedIn, brandClassName: 'text-[#0A66C2]' },
  {
    label: 'WhatsApp',
    url: siteConfig.socialLinks.whatsapp,
    icon: IconWhatsApp,
    brandClassName: 'text-[#25D366]',
    hoverClassName: 'hover:text-[#1DA851]',
  },
  { label: 'Instagram', url: siteConfig.socialLinks.instagram, icon: IconInstagram, brandClassName: 'text-[#E1306C]' },
];

/**
 * Thin utility bar above the main header — approved homepage redesign,
 * tier 1 of 3 (see PublicHeader). Not sticky; scrolls away with the rest
 * of the page, leaving the main header + nav (which are sticky) as the
 * persistent chrome.
 *
 * Social icons: a real link renders only when siteConfig.socialLinks has
 * a real URL for that platform. WhatsApp is configured today; Facebook,
 * LinkedIn, and Instagram are still `null`, so those render as inert,
 * non-navigating placeholders (aria-disabled, no href, cursor-not-allowed,
 * "not yet configured" tooltip) rather than link to a guessed URL — but
 * still in full brand color, per design direction, so the disabled state
 * reads through interactivity cues rather than a washed-out icon. Fill in
 * siteConfig.socialLinks once a platform's real profile URL is confirmed
 * and it becomes a live link with no other changes needed.
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
                    className={`${platform.brandClassName} ${platform.hoverClassName ?? ''}`}
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
                  className={`cursor-not-allowed ${platform.brandClassName}`}
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
