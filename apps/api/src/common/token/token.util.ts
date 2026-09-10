import { createHash, randomBytes } from 'node:crypto';

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

/**
 * Password recovery (Stage 1): one-way hash of a generateToken() value for
 * storage — AccountToken.tokenHash holds only this, never the raw token,
 * so a database read/leak alone can never be replayed as a valid reset
 * link (the same reasoning User.passwordHash already applies to
 * passwords). Plain SHA-256, not bcrypt: unlike a password, this input is
 * already 256 bits of uniformly random CSPRNG output — there is no
 * low-entropy human-chosen value here for bcrypt's deliberate slowness to
 * defend against, so a fast, deterministic hash is the correct tool
 * (needed anyway for an exact-match unique lookup, which bcrypt's
 * per-call salt would make impossible).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
