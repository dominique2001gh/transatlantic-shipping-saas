import type { LoginResponseDto } from '@transatlantic/shared';
import { apiFetch } from './api';

const PENDING_KEY = 'transatlantic.mfaPending';

interface PendingMfaState {
  mfaToken: string;
  /** Where to send the user once MFA succeeds — same allow-listed path resolveSafeNextPath already validated on /login; never re-validated here since it was already checked once before being stored. */
  nextPath: string | null;
}

/**
 * Email-based staff MFA (2026-10): the short-lived `mfaToken` POST
 * /auth/login returns for a STAFF_ROLES account travels from the login
 * page to /mfa via sessionStorage, not a URL query param — a query param
 * would land in browser history/referrer headers, sessionStorage doesn't.
 * Per-tab by nature (matching the token's own short TTL — there is no
 * legitimate reason a pending MFA step should survive a closed tab), and
 * cleared the moment it's consumed, successfully or not.
 */
export function storePendingMfa(state: PendingMfaState): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(state));
}

export function getPendingMfa(): PendingMfaState | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingMfaState;
  } catch {
    return null;
  }
}

export function clearPendingMfa(): void {
  sessionStorage.removeItem(PENDING_KEY);
}

/** Emails a fresh 6-digit code — called once right after login, and again for an explicit resend. */
export function sendMfaOtp(mfaToken: string): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/auth/mfa/send', { method: 'POST', token: mfaToken });
}

export function verifyMfaOtp(mfaToken: string, code: string): Promise<LoginResponseDto> {
  return apiFetch<LoginResponseDto>('/auth/mfa/challenge', { method: 'POST', token: mfaToken, body: JSON.stringify({ code }) });
}
