import type { Metadata } from 'next';

/** demo/page.tsx is a client component — see pricing/layout.tsx's own comment for why metadata lives here instead. */
export const metadata: Metadata = {
  title: 'Request a Demo',
  description: 'See AnanseLogix running on a workflow like yours — request a demo and tell us about your shipping business.',
  alternates: { canonical: '/ananselogix/demo' },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
