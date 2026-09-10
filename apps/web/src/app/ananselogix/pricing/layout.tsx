import type { Metadata } from 'next';

/**
 * pricing/page.tsx is a client component (it fetches live plan data), so
 * it can't export `metadata` itself — Next.js only reads that export from
 * server components. This sibling layout carries it instead.
 */
export const metadata: Metadata = {
  title: 'Pricing',
  description: 'AnanseLogix pricing — Website Only, Software Only, or Website + Software. Plans and pricing are configured by our team and reflected here in real time.',
  // Step 3: unprefixed — see ananselogix/page.tsx's own doc comment.
  alternates: { canonical: '/pricing' },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
