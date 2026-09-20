import type { AuthenticatedUser } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import { homeRouteForRole } from './auth';
import { getOnboardingOverview } from './onboarding';

/**
 * The single "where does this user land after signing in" decision,
 * shared by every login entry point (the central AnanseLogix login and
 * any tenant-branded one) so the rule can never drift between them.
 *
 * An OWNER who hasn't finished the post-signup onboarding wizard is sent
 * there first, instead of straight to
 * /dashboard — checked only at login (not on every dashboard load) so
 * this stays a one-time redirect, not a recurring extra request for staff
 * who onboarded long ago. A failure here (e.g. no TenantOnboarding row —
 * Trans Atlantic predates this layer) is swallowed and falls through to
 * the normal role-based destination, never blocking login.
 *
 * This is a UX convenience only, same as homeRouteForRole itself — the
 * tenant/role driving the decision comes from the authenticated user
 * object the backend already returned from a verified JWT, never from
 * anything the browser could supply independently.
 */
export async function resolvePostLoginRoute(user: AuthenticatedUser): Promise<string> {
  if (user.role === UserRole.OWNER) {
    try {
      const overview = await getOnboardingOverview();
      if (overview.onboarding.currentStep !== 'DONE') {
        return '/onboarding';
      }
    } catch {
      // No onboarding record, or the request failed — fall through.
    }
  }
  return homeRouteForRole(user.role);
}

/**
 * /dropoff entry point: the only post-auth destination allowed to override
 * homeRouteForRole's normal role-based landing. An exact-match allow-list
 * of one, not a general "redirect to any path" mechanism — a `next` query
 * param is untrusted browser input, and this is what stops it from ever
 * becoming an open redirect (arbitrary path, let alone arbitrary host).
 * Extend this set, never loosen the match, if another entry point needs
 * the same "come back here after signing in" behavior later.
 */
const ALLOWED_NEXT_PATHS = new Set(['/portal/pre-register']);

export function resolveSafeNextPath(nextParam: string | null | undefined): string | null {
  if (!nextParam) return null;
  return ALLOWED_NEXT_PATHS.has(nextParam) ? nextParam : null;
}
