import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { headers } from 'next/headers';
import { resolveBrandIconVariant } from '@/lib/brand-icon';

/**
 * Apple home-screen icon counterpart to icon.tsx — see that file's own
 * doc comment for why this needed to become Host-aware, and for why it
 * reads the asset via plain fs.readFile rather than
 * `new URL(literal, import.meta.url)` + fetch.
 */
export const dynamic = 'force-dynamic';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

async function loadIconBuffer(host: string | null): Promise<Buffer> {
  const variant = resolveBrandIconVariant(host);
  const filePath = path.join(process.cwd(), 'src/app/_brand-assets', `${variant}-apple-icon.png`);
  return readFile(filePath);
}

export default async function AppleIcon() {
  const requestHeaders = await headers();
  const buffer = await loadIconBuffer(requestHeaders.get('host'));
  return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': contentType } });
}
