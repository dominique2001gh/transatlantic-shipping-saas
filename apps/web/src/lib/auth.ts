import type { AuthenticatedUser } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';

const TOKEN_KEY = 'transatlantic.accessToken';
const USER_KEY = 'transatlantic.user';

/**
 * NOTE: localStorage is used here for milestone-1 simplicity so the
 * frontend shell can demonstrate the login round-trip end-to-end. It is
 * readable by any script on the page (XSS risk). Before this ships to
 * real users, move the access token to an httpOnly, Secure, SameSite
 * cookie set by the API and drop this module.
 */
export function storeSession(accessToken: string, user: AuthenticatedUser): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthenticatedUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthenticatedUser;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Where to send a user immediately after login, based on their role. */
export function homeRouteForRole(role: UserRole): string {
  switch (role) {
    case UserRole.PLATFORM_ADMIN:
      return '/platform';
    case UserRole.CUSTOMER:
      return '/portal';
    default:
      return '/dashboard';
  }
}
