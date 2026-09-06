import type { AuthenticatedUser } from '@transatlantic/shared';
import { UserRole } from '@transatlantic/shared';
import { homeRouteForRole } from './auth';
import { getOnboardingOverview } from './onboarding';

/**
 * The single "where does this user land after signing in" decision,
 * shared by every login entry point (the central AnanseLogix login and
 * any tenant-branded one) so the rule can never drift between them.
 *
 * A TENANT_OWNER/TENANT_ADMIN who hasn't finished the post-signup
 * onboarding wizard is sent there first, instead of straight to
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
  if (user.role === UserRole.TENANT_OWNER || user.role === UserRole.TENANT_ADMIN) {
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
