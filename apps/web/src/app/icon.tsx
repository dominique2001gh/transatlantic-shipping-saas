import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { headers } from 'next/headers';
import { resolveBrandIconVariant } from '@/lib/brand-icon';

/**
 * App-root icon, made dynamic (Host-aware) to fix the Titanic branding
 * leak — see brand-icon.ts's own doc comment for the full reasoning. This
 * used to be a static icon.png (Trans Atlantic's), which every shared
 * multi-tenant route not rewritten under /ananselogix (/dashboard,
 * /portal, /platform, /onboarding) inherited regardless of which tenant
 * or brand actually owned the request. AnanseLogix's own marketing pages
 * are unaffected — /ananselogix/icon.png is a more specific file and
 * always wins there under Next's nearest-file-wins icon convention.
 *
 * `force-dynamic` is explicit (not just implied by calling headers()) so
 * this is never accidentally frozen into a single build-time favicon.
 */
export const dynamic = 'force-dynamic';
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

// Plain fs.readFile against a process.cwd()-relative path — NOT
// `new URL(literal, import.meta.url)` + fetch (the pattern Next's own
// docs use for edge-runtime font loading in ImageResponse). Under this
// route's default Node.js runtime, webpack rewrites that pattern into a
// client-facing `/_next/static/media/...` path string, which isn't a
// valid URL for server-side fetch() and throws at request time.
// process.cwd() is this app's own root (apps/web) under `next start`,
// the same assumption next.config.mjs's absence of `output: 'standalone'`
// already makes.
async function loadIconBuffer(host: string | null): Promise<Buffer> {
  const variant = resolveBrandIconVariant(host);
  const filePath = path.join(process.cwd(), 'src/app/_brand-assets', `${variant}-icon.png`);
  return readFile(filePath);
}

export default async function Icon() {
  const requestHeaders = await headers();
  const buffer = await loadIconBuffer(requestHeaders.get('host'));
  return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': contentType } });
}
