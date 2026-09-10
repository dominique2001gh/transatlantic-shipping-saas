import type { Metadata } from 'next';

/** login/page.tsx is a client component — see pricing/layout.tsx's own comment for why metadata lives here instead. */
export const metadata: Metadata = {
  title: 'Log In',
  description: 'Sign in to your Ananse Logix account.',
  // Step 3: unprefixed — see ananselogix/page.tsx's own doc comment.
  alternates: { canonical: '/login' },
};

export default function AnanseLogixLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
