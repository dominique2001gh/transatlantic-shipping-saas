'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Stage 2C-4: retired. A logged-in customer already sees every shipment on
 * their account at /portal/shipments (and its own tracking timeline at
 * /portal/shipments/:id) — a separate tracking-number lookup form inside
 * the authenticated portal would just be a redundant second way to reach
 * the same data. Redirects rather than 404s so the nav item/any bookmark
 * still goes somewhere useful.
 *
 * Client-side redirect (matching useRequireAuth's own router.replace
 * pattern), not next/navigation's server-side redirect() — this route is
 * nested under portal/layout.tsx, a Client Component whose own loading
 * gate means a Server Component redirect() here never gets a chance to
 * fire during the initial render.
 */
export default function PortalTrackPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/portal/shipments');
  }, [router]);

  return null;
}
