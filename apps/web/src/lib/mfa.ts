import type { LoginResponseDto, MfaEnrollmentCompleteResponse, MfaSetupResponse, MfaStatusResponse } from '@transatlantic/shared';
import { apiFetch } from './api';

const PENDING_KEY = 'transatlantic.mfaPending';

interface PendingMfaState {
  mfaToken: string;
  mfaEnrolled: boolean;
  /** Where to send the user once MFA succeeds — same allow-listed path resolveSafeNextPath already validated on /login; never re-validated here since it was already checked once before being stored. */
  nextPath: string | null;
}

/**
 * Platform-wide staff MFA (2026-10): the short-lived `mfaToken` POST
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

export function beginMfaSetup(mfaToken: string): Promise<MfaSetupResponse> {
  return apiFetch<MfaSetupResponse>('/auth/mfa/setup', { method: 'POST', token: mfaToken });
}

export function verifyMfaSetup(mfaToken: string, code: string): Promise<MfaEnrollmentCompleteResponse> {
  return apiFetch<MfaEnrollmentCompleteResponse>('/auth/mfa/setup/verify', {
    method: 'POST',
    token: mfaToken,
    body: JSON.stringify({ code }),
  });
}

export function mfaChallenge(mfaToken: string, params: { code?: string; recoveryCode?: string }): Promise<LoginResponseDto> {
  return apiFetch<LoginResponseDto>('/auth/mfa/challenge', { method: 'POST', token: mfaToken, body: JSON.stringify(params) });
}

export function getMfaStatus(token: string): Promise<MfaStatusResponse> {
  return apiFetch<MfaStatusResponse>('/users/me/mfa/status', { token });
}

export function beginFactorReplace(token: string, currentPassword: string): Promise<MfaSetupResponse & { replaceToken: string }> {
  return apiFetch('/users/me/mfa/replace', { method: 'POST', token, body: JSON.stringify({ currentPassword }) });
}

export function completeFactorReplace(token: string, replaceToken: string, code: string): Promise<{ recoveryCodes: string[] }> {
  return apiFetch('/users/me/mfa/replace/verify', { method: 'POST', token, body: JSON.stringify({ replaceToken, code }) });
}
