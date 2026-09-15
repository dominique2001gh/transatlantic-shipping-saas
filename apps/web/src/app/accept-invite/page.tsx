import { headers } from 'next/headers';
import { resolveBrandIconVariant } from '@/lib/brand-icon';
import AcceptInviteClient from './AcceptInviteForm';

/**
 * Multi-tenant branding fix (2026-09): a real server component (no 'use
 * client' here) so the Host header can be read at request time — the same
 * `headers()` + resolveBrandIconVariant pattern app/icon.tsx already uses
 * to fix the exact same class of bug for favicons (see that file's own
 * doc comment). Deciding the brand server-side, once, and passing it down
 * as a plain prop avoids a client-side flash-of-wrong-brand and needs no
 * new hostname-matching logic — brand-icon.ts's existing, already-tested
 * rule ("a Trans Atlantic hostname gets Trans Atlantic's brand, every
 * other hostname — ananselogix.com, a future tenant's own domain once
 * that's wired up, local dev — gets AnanseLogix's") is exactly right here
 * too: this page is reachable from any tenant's invitation email, not
 * just Trans Atlantic's.
 *
 * Previously this whole route lived under app/(public)/accept-invite,
 * inheriting PublicLayout's full marketing PublicHeader/PublicFooter
 * (Trans Atlantic's real nav, phone, email, address) unconditionally —
 * that's the other half of the reported bug. This route is now top-level
 * (outside that layout group, same URL — Next.js route groups never
 * affect the URL), so an account-activation page never carries a
 * marketing site's chrome for *any* tenant, not just a re-branded one.
 * /login, /register, /forgot-password, /reset-password are unaffected —
 * they stay under (public) exactly as before.
 *
 * `force-dynamic` is required (not just implied by calling headers()) so
 * this is never accidentally frozen into a single build-time brand.
 */
export const dynamic = 'force-dynamic';

export default async function AcceptInvitePage() {
  const requestHeaders = await headers();
  const brand = resolveBrandIconVariant(requestHeaders.get('host'));
  return <AcceptInviteClient brand={brand} />;
}
