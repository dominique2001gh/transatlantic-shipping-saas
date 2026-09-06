import { randomBytes } from 'node:crypto';

/**
 * AnanseLogix Phase 1: generates an unguessable, URL-safe token for
 * anything looked up by possession-of-the-token rather than an
 * authenticated session — SignupSession.token, TenantInvitation.token.
 * 32 bytes of CSPRNG output, hex-encoded (64 chars) — the same entropy
 * class JWT_SECRET's own generation comment in .env.example specifies.
 */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}
