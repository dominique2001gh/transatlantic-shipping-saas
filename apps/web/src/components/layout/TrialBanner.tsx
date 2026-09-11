import Link from 'next/link';

/**
 * Free Trial stage: the persistent, always-visible trial-status indicator
 * — shown on every dashboard page (not just once in the onboarding
 * wizard's own Billing step, which only a first-time visitor sees). Reads
 * from GET /tenants/me via useTenant, reachable by every staff role
 * (including once a trial has expired and the tenant is otherwise
 * SUSPENDED), so nobody is surprised when access locks.
 */
export function TrialBanner({ planName, trialEndsAt }: { planName: string; trialEndsAt: string }) {
  const msRemaining = new Date(trialEndsAt).getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
  const expired = msRemaining <= 0;

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
      <Link href="/onboarding" className={`font-semibold underline ${expired ? 'text-red-900' : 'text-accent-900'}`}>
        {expired ? 'Activate Paid Billing' : 'Manage Billing'}
      </Link>
    </div>
  );
}
