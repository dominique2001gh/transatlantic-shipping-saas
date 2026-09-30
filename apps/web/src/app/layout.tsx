import type { Metadata } from 'next';
import { Inter, Manrope } from 'next/font/google';
import { siteConfig } from '@/lib/site-config';
import './globals.css';

// Self-hosted via next/font at build time — no extra dependency, no
// runtime request to Google Fonts. `--font-sans` is body text,
// `--font-display` is used for headings (see tailwind.config.ts).
const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

/**
 * Deliberately still static/Trans-Atlantic-only, unchanged from before the
 * multi-tenant branding fix — a hostname-aware version of this used to
 * live here, but making the ROOT layout depend on headers() forces every
 * single route in the app (dashboard, platform, portal, everything) to
 * become dynamic, not just the tenant-facing public ones that actually
 * needed it. The hostname-aware default now lives one level down, in
 * (public)/layout.tsx (see that file's own doc comment) — the same route
 * group already made dynamic by that layout's own header/footer fix, so
 * this scopes the cost to exactly the routes that need it. Every page
 * outside (public) (dashboard/platform/portal/ananselogix) is completely
 * unaffected by any of this and keeps whatever prerendering it already had.
 */
export const metadata: Metadata = {
  title: {
    default: `${siteConfig.companyName} · ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.shortName}`,
  },
  description: siteConfig.description,
  openGraph: {
    type: 'website',
    siteName: siteConfig.companyName,
    title: `${siteConfig.companyName} · ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
