import { randomInt } from 'node:crypto';

/**
 * Platform-wide staff MFA (2026-10): human-typeable one-time recovery
 * codes (e.g. "7K2M-9QXD") for the "lost the authenticator device" case —
 * see MfaRecoveryCode's own doc comment for the hashed-at-rest storage
 * side. Alphabet deliberately excludes visually-ambiguous characters
 * (0/O, 1/I/L) since these are meant to be read off a screen and typed
 * back in, not scanned.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_GROUP_LENGTH = 4;
const CODE_GROUPS = 2;
const RECOVERY_CODE_COUNT = 8;

function generateOneRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < CODE_GROUPS; g++) {
    let group = '';
    for (let i = 0; i < CODE_GROUP_LENGTH; i++) {
      group += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/** Generates a fresh batch of recovery codes — always replaces the previous batch entirely (see MfaService.replaceFactor/verifyEnrollment), never appends to it. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, generateOneRecoveryCode);
}

/** Normalizes user-submitted recovery code input before hashing/lookup — case/whitespace-insensitive, same reasoning as every other token comparison in this codebase. */
export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase();
}
