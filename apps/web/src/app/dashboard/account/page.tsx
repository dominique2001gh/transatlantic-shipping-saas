'use client';

import { Card } from '@/components/ui/Card';
import { MfaSection } from '@/components/account/MfaSection';
import { PasswordSection } from '@/components/account/PasswordSection';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { DASHBOARD_ROLES } from '@transatlantic/shared';

/**
 * "My Account" / Account & Security (2026-10): the one page every staff
 * role (OWNER/MANAGER/STAFF/FINANCE) reaches for their own password and
 * MFA — deliberately separate from /dashboard/settings, which is
 * ONBOARDING_ROLES (OWNER-only) company/tenant administration. Personal
 * account/security must never require company-admin access just to
 * change a password or replace an MFA factor — see PasswordSection's and
 * MfaSection's own doc comments for why both already scope every write to
 * the caller's own account server-side (never a userId/tenantId of their
 * own), which is what makes mounting them here, open to every dashboard
 * role, safe by construction.
 */
export default function AccountPage() {
  const { user, loading } = useRequireAuth(DASHBOARD_ROLES);

  if (loading || !user) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">My Account</h1>
        <p className="mt-1 text-sm text-slate-500">Your own profile, password, and two-factor authentication.</p>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
        <Card className="mt-3 max-w-lg">
          <dl className="flex flex-col gap-4 text-sm">
            <div>
              <dt className="font-medium text-slate-700">Name</dt>
              <dd className="mt-1 text-slate-600">{`${user.firstName} ${user.lastName}`}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Email</dt>
              <dd className="mt-1 text-slate-600">{user.email}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Role</dt>
              <dd className="mt-1 text-slate-600">{user.role}</dd>
            </div>
          </dl>
        </Card>
      </section>

      <PasswordSection />

      <MfaSection email={user.email} />
    </div>
  );
}
