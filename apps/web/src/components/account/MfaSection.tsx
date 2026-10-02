import { Card } from '@/components/ui/Card';

/**
 * Email-based staff MFA (2026-10): every staff role has MFA enrolled by
 * construction — there is no "set up" or "replace factor" action to take,
 * since the factor is simply the account's own registered email address
 * (see JwtStrategy's own doc comment — there is no way to hold a staff
 * session without completing the email code step). This section is
 * purely informational; changing the delivery address means changing the
 * account's email itself, a separate concern this page doesn't own.
 */
export function MfaSection({ email }: { email: string }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">Two-factor authentication</h2>
      <Card className="mt-3 max-w-lg">
        <p className="text-sm text-slate-600">
          Required for your account. Each time you sign in, we email a one-time verification code to{' '}
          <span className="font-medium text-slate-900">{email}</span>.
        </p>
      </Card>
    </section>
  );
}
