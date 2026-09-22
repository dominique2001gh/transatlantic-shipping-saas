'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PaymentMethod, UserRole } from '@transatlantic/shared';
import type { TenantPaymentMethodConfigItem, TenantStripeConnectStatus } from '@transatlantic/shared';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';
import { humanizeEnumValue } from '@/lib/format';
import {
  createStripeOnboardingLink,
  getPaymentMethodsConfig,
  getStripeConnectStatus,
  savePaymentMethodsConfig,
} from '@/lib/tenant-payments';

/** Placeholder text hinting at what belongs in each method's customer-facing instructions — purely a UX nudge, never validated or enforced. */
const INSTRUCTIONS_PLACEHOLDER: Partial<Record<PaymentMethod, string>> = {
  [PaymentMethod.CASH_APP]: 'e.g. $TransAtlanticLogistics',
  [PaymentMethod.ZELLE]: 'e.g. payments@yourcompany.com or (555) 123-4567',
  [PaymentMethod.BANK_TRANSFER]: 'e.g. Bank name, account name/number, routing number',
  [PaymentMethod.CHECK]: 'e.g. Payable to "Your Company" — mailing address',
  [PaymentMethod.MOBILE_MONEY]: 'e.g. Provider name and number',
  [PaymentMethod.CASH]: 'e.g. Pay in person at our warehouse counter',
  [PaymentMethod.OTHER]: 'Describe how a customer should pay this way',
};

/**
 * Tenant Payment Configuration Phase B: the minimal OWNER-only "Connect
 * Stripe" surface for the already-built, already-tested Connect backend
 * (see TenantPaymentsController/TenantPaymentsStripeService) — this page
 * adds no new backend behavior, it is the first real UI for endpoints
 * that previously had none. Deliberately its own route (not folded into
 * the existing /dashboard/settings page, which is single-purpose public-
 * website content) so it can grow a Manual Payment Methods section
 * (Phase D) without bloating that page's scope.
 *
 * `?stripeConnect=refresh|return` (set by the backend's own
 * onboarding-link redirect URLs) is read only to decide whether to show a
 * transient "check back in a moment" notice while re-polling GET
 * /tenant-payments/connect/status — never treated as proof of anything by
 * itself; `isActive` only ever changes via the account.updated webhook.
 */
export default function PaymentsSettingsPage() {
  const currentUser = getStoredUser();
  const isOwner = currentUser?.role === UserRole.OWNER;
  const searchParams = useSearchParams();
  const stripeConnectReturn = searchParams.get('stripeConnect'); // 'refresh' | 'return' | null

  const [status, setStatus] = useState<TenantStripeConnectStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;

    async function load() {
      try {
        const data = await getStripeConnectStatus();
        if (!cancelled) setStatus(data);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Failed to load Stripe connection status.');
      }
    }

    load();
    // Returning from Stripe's hosted onboarding: the account.updated
    // webhook that actually flips isActive can land a moment after the
    // browser does. One short re-check covers the common case without
    // turning this into an open-ended poll — the page is still
    // reload-able at any time regardless.
    if (stripeConnectReturn === 'return') {
      const timer = setTimeout(load, 2000);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [isOwner, stripeConnectReturn]);

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const { url } = await createStripeOnboardingLink();
      // Full-page navigation, deliberately — hands off to Stripe's own
      // hosted onboarding, same pattern the customer portal's "Pay Now"
      // already uses for Checkout.
      window.location.href = url;
    } catch (err) {
      setConnectError(err instanceof ApiError ? err.message : 'Unable to start Stripe onboarding. Please try again.');
      setConnecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/settings" className="text-sm font-medium text-primary-700 hover:text-primary-800">
          ← Settings
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Payments</h1>
        <p className="mt-1 text-sm text-slate-500">
          Control how your customers pay their invoices — online by card via Stripe, and manual methods like Cash
          App, Zelle, cash, check, or bank transfer.
        </p>
      </div>

      {!isOwner && (
        <Card>
          <p className="text-sm text-slate-600">Only the tenant owner can view or change payment configuration.</p>
        </Card>
      )}

      {isOwner && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Card payments (Stripe)</h2>
          <Card className="mt-3">
            {loadError && <p className="text-sm text-red-600">{loadError}</p>}
            {!loadError && !status && <p className="text-sm text-slate-500">Loading…</p>}
            {status && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  {status.isActive ? (
                    <p className="text-sm font-medium text-emerald-700">
                      Connected and ready — your customers&apos; card payments go directly to your own Stripe
                      account.
                    </p>
                  ) : status.connected ? (
                    <p className="text-sm font-medium text-amber-700">
                      Onboarding started but not yet complete — Stripe is still verifying your account. Card
                      payments continue to route through the platform account until this finishes.
                    </p>
                  ) : (
                    <p className="text-sm text-slate-600">
                      Not connected yet. Your customers can already pay by card — payments currently route through
                      the platform&apos;s Stripe account until you connect your own.
                    </p>
                  )}
                  {stripeConnectReturn === 'return' && !status.isActive && (
                    <p className="mt-1 text-xs text-slate-500">
                      Just finished with Stripe? This can take a few seconds to confirm — refresh if it doesn&apos;t
                      update shortly.
                    </p>
                  )}
                </div>
                <Button onClick={handleConnect} disabled={connecting} variant={status.connected ? 'secondary' : 'primary'}>
                  {connecting ? 'Starting…' : status.connected ? 'Resume Setup' : 'Connect Stripe'}
                </Button>
              </div>
            )}
            {connectError && <p className="mt-3 text-sm text-red-600">{connectError}</p>}
            <p className="mt-4 text-xs text-slate-400">
              We never see or store your Stripe password or secret API keys — Stripe&apos;s own secure onboarding
              collects everything directly.
            </p>
          </Card>
        </section>
      )}

      {isOwner && <ManualMethodsSection />}
    </div>
  );
}

/**
 * Tenant Payment Configuration Phase D: enable/disable + author
 * customer-facing instructions for each manual method. Always renders
 * every method in MANUAL_PAYMENT_METHODS (the GET response already
 * synthesizes a default row for anything not yet configured — see
 * TenantPaymentMethodsService.getConfigForTenant's own doc comment), so
 * the very first save preserves today's real behavior unless the tenant
 * actively changes something.
 */
function ManualMethodsSection() {
  const [methods, setMethods] = useState<TenantPaymentMethodConfigItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPaymentMethodsConfig()
      .then((data) => {
        if (!cancelled) setMethods(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Failed to load payment methods.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateMethod(method: PaymentMethod, patch: Partial<TenantPaymentMethodConfigItem>) {
    setSaved(false);
    setMethods((current) => current?.map((item) => (item.method === method ? { ...item, ...patch } : item)) ?? current);
  }

  async function handleSave() {
    if (!methods) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await savePaymentMethodsConfig(methods);
      setMethods(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to save payment methods.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">Manual payment methods</h2>
      <p className="mt-1 text-sm text-slate-500">
        Enable the ways your customers can pay outside of Stripe, and provide your own payment details for each.
        Customers see these as instructions only — a staff member must still record the payment once received
        (Invoices → Record Payment).
      </p>

      <Card className="mt-3">
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {!loadError && !methods && <p className="text-sm text-slate-500">Loading…</p>}
        {methods && (
          <div className="flex flex-col divide-y divide-slate-100">
            {methods.map((item) => (
              <div key={item.method} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
                <label className="flex w-48 shrink-0 items-center gap-2 text-sm font-medium text-slate-900">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(event) => updateMethod(item.method, { enabled: event.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-primary-700 focus:ring-primary-500"
                  />
                  {humanizeEnumValue(item.method)}
                </label>
                <input
                  type="text"
                  aria-label={`${humanizeEnumValue(item.method)} instructions`}
                  placeholder={INSTRUCTIONS_PLACEHOLDER[item.method] ?? 'Customer-facing instructions (optional)'}
                  value={item.instructions ?? ''}
                  onChange={(event) => updateMethod(item.method, { instructions: event.target.value || null })}
                  maxLength={500}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            ))}
          </div>
        )}
        {saveError && <p className="mt-3 text-sm text-red-600">{saveError}</p>}
        {saved && <p className="mt-3 text-sm text-emerald-700">Saved.</p>}
        {methods && (
          <Button onClick={handleSave} disabled={saving} className="mt-4">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </Card>
    </section>
  );
}
