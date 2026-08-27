import type { Metadata } from 'next';
import { Inter, Manrope } from 'next/font/google';
import { siteConfig } from '@/lib/site-config';
import './globals.css';

// Self-hosted via next/font at build time — no extra dependency, no
// runtime request to Google Fonts. `--font-sans` is body text,
// `--font-display` is used for headings (see tailwind.config.ts).
const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

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
