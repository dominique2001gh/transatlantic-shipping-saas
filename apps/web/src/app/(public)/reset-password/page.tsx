import { headers } from 'next/headers';
import { resolveBrandIconVariant } from '@/lib/brand-icon';
import { ResetPasswordPageClient } from './ResetPasswordPageClient';

/**
 * Multi-tenant branding fix: thin Server Component wrapper around
 * ResetPasswordPageClient.tsx (see that file's own doc comment for the
 * actual page and its history). Only job here is resolving `brand`
 * server-side from the request's own Host header — the same
 * resolveBrandIconVariant /register and /forgot-password already use.
 */
export default async function ResetPasswordPage() {
  const host = (await headers()).get('host');
  const brand = resolveBrandIconVariant(host);
  return <ResetPasswordPageClient brand={brand} />;
}
