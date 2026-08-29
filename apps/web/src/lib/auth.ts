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

/** Module-level guard so a burst of concurrent 401s (or a 401 racing a manual click) only navigates once. */
let loggingOut = false;

/**
 * Canonical logout. Clears the stored session and sends the user to
 * /login via a full navigation (not client-side router.push) so that no
 * stale in-memory state anywhere in the tree — tenant name, sidebar,
 * cached user label — can survive; the whole app remounts fresh.
 *
 * Deliberately does not call the API: there is no server-side session or
 * refresh-token to revoke (JWTs here are stateless, verified only by
 * signature/expiry — see JwtStrategy), so this only ever touches
 * localStorage and the browser location. That also means it works
 * reliably even when the current token is already expired or invalid —
 * nothing here depends on it being valid.
 *
 * Guarded against redirect loops: a no-op once already on /login, and
 * idempotent if called more than once (e.g. several in-flight requests
 * all 401 together).
 */
export function logout(): void {
  if (loggingOut) return;
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/login') return;
  loggingOut = true;
  clearSession();
  window.location.href = '/login';
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
