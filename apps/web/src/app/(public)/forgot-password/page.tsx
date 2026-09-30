import { headers } from 'next/headers';
import { resolveBrandIconVariant } from '@/lib/brand-icon';
import { ForgotPasswordPageClient } from './ForgotPasswordPageClient';

/**
 * Multi-tenant branding fix: thin Server Component wrapper around
 * ForgotPasswordPageClient.tsx (see that file's own doc comment for the
 * actual page and its history). Only job here is resolving `brand`
 * server-side from the request's own Host header — the same
 * resolveBrandIconVariant this app already uses for /register, /accept-
 * invite's own AuthShell, and the app-wide favicon fallback — so there is
 * never a flash of the wrong brand on first render.
 */
export default async function ForgotPasswordPage() {
  const host = (await headers()).get('host');
  const brand = resolveBrandIconVariant(host);
  return <ForgotPasswordPageClient brand={brand} />;
}
