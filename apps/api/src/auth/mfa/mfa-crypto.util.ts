import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/**
 * Platform-wide staff MFA (2026-10): encrypts/decrypts `User.mfaSecret` at
 * rest. A TOTP secret is long-lived (it isn't rotated per-use the way a
 * password hash's input is), so unlike a password it is never hashed —
 * hashing would make it unrecoverable, and the server genuinely needs the
 * plaintext secret back on every login to compute the expected code.
 * AES-256-GCM (authenticated encryption, built into Node's own `crypto`,
 * not a third-party or hand-rolled primitive) with a random 12-byte IV per
 * encryption and the GCM auth tag stored alongside it — a tampered
 * ciphertext fails to decrypt rather than silently returning garbage.
 *
 * Output format: `<iv>:<authTag>:<ciphertext>`, each hex-encoded — plain
 * text, safe to store in a single TEXT column, trivially parsed back by
 * `decryptMfaSecret`.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

function resolveKey(config: ConfigService): Buffer {
  const hex = config.get<string>('MFA_ENCRYPTION_KEY');
  if (!hex) {
    throw new InternalServerErrorException('Missing required env var "MFA_ENCRYPTION_KEY"');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new InternalServerErrorException('MFA_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex characters)');
  }
  return key;
}

export function encryptMfaSecret(config: ConfigService, plainTextSecret: string): string {
  const key = resolveKey(config);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainTextSecret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptMfaSecret(config: ConfigService, encrypted: string): string {
  const key = resolveKey(config);
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new InternalServerErrorException('Malformed encrypted MFA secret');
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}
