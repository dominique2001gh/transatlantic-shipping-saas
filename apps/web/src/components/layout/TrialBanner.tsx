import Link from 'next/link';
import { UserRole } from '@transatlantic/shared';

/**
 * Free Trial stage: the persistent, always-visible trial-status indicator
 * — shown on every dashboard page (not just once in the onboarding
 * wizard's own Billing step, which only a first-time visitor sees). Reads
 * from GET /tenants/me via useTenant, reachable by every staff role
 * (including once a trial has expired and the tenant is otherwise
 * SUSPENDED), so nobody is surprised when access locks.
 *
 * RBAC billing-link fix (2026-09): the "Manage Billing"/"Activate Paid
 * Billing" action links to /onboarding, whose billing step is OWNER-only
 * (ONBOARDING_ROLES). Only OWNER gets the link — every other role still
 * sees the informational trial-status text (they should know access is
 * about to lock even though only OWNER can act on it), just without a
 * link that would land them on a page they have no access to.
 */
export function TrialBanner({
  planName,
  trialEndsAt,
  role,
}: {
  planName: string;
  trialEndsAt: string;
  role: UserRole;
}) {
  const msRemaining = new Date(trialEndsAt).getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
  const expired = msRemaining <= 0;
  const canManageBilling = role === UserRole.OWNER;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 text-sm sm:px-6 lg:px-8 ${
        expired ? 'border-red-200 bg-red-50 text-red-800' : 'border-accent-200 bg-accent-50 text-accent-800'
      }`}
    >
      <p>
        {expired ? (
          <>
            <span className="font-semibold">{planName} trial has ended.</span> Activate paid billing to continue using AnanseLogix.
          </>
        ) : (
          <>
            🎉 <span className="font-semibold">{planName} — Free Trial</span> — {daysRemaining} day{daysRemaining === 1 ? '' : 's'} remaining
            (ends {new Date(trialEndsAt).toLocaleDateString()})
          </>
        )}
      </p>
      {canManageBilling && (
        <Link href="/onboarding" className={`font-semibold underline ${expired ? 'text-red-900' : 'text-accent-900'}`}>
          {expired ? 'Activate Paid Billing' : 'Manage Billing'}
        </Link>
      )}
    </div>
  );
}
