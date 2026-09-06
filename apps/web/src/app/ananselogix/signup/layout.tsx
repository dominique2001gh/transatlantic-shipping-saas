import type { Metadata } from 'next';

/**
 * The signup wizard and its success page are transactional, not indexable
 * content (see robots.ts's own disallow entry for /ananselogix/signup) —
 * this metadata is for the browser tab only, not search visibility.
 */
export const metadata: Metadata = {
  title: 'Start Your Company',
  robots: { index: false, follow: false },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
