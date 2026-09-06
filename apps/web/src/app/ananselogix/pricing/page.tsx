'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconCheckCircle } from '@/components/icons';
import { PageHero } from '@/components/marketing/PageHero';
import { LinkButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { ApiError } from '@/lib/api';
import { PLAN_DISPLAY_NAMES, fetchPublicPlans, formatCents } from '@/lib/ananselogix/plans';
import type { SaasPlanSummary } from '@transatlantic/shared';

const PLAN_BLURBS: Record<SaasPlanSummary['key'], string> = {
  WEBSITE_ONLY: 'A professional branded logistics website with ongoing hosting and maintenance — no operations software included.',
  SOFTWARE_ONLY: 'For logistics companies that already have a website and want the AnanseLogix operations platform.',
  WEBSITE_AND_SOFTWARE: 'The complete AnanseLogix package - the branded website and the full operations platform, together.',
  SOFTWARE_AND_WEBSITE_BASIC: 'The complete AnanseLogix platform — branded website and full operations software together — at our lowest combined price.',
  SOFTWARE_AND_WEBSITE_PROFESSIONAL: 'The same complete AnanseLogix platform as Basic — branded website and full operations software together.',
};

/** Everything included in the Website Only plan — hosting/maintenance-focused. */
const WEBSITE_ONLY_FEATURES: string[] = [
  'Branded, responsive logistics website',
  'Custom company branding',
  'Services, About, and Contact pages',
  'Locations',
  'Quote / contact forms',
  'WhatsApp & contact integration',
  'Domain connection, hosting, security, and backups',
  'Basic SEO',
  'Minor content updates & support',
];

/**
 * The combined website + operations-software bundle — identical for both
 * Basic and Professional today. No feature differentiation between the two
 * tiers was specified when they were introduced; a platform admin can
 * narrow either one's entitlements per-tenant later (see
 * plan-entitlements.ts's own doc comment) if a real tier split is wanted.
 */
const SOFTWARE_AND_WEBSITE_FEATURES: string[] = [
  ...WEBSITE_ONLY_FEATURES,
  'Customer management',
  'Shipment management',
  'Warehouse receiving & barcode/QR label workflow',
  'Processing / inspection',
  'Container loading & management',
  'Manifest management',
  'Ocean, Air, and RoRo workflows',
  'Destination receiving, pickup & delivery',
  'Public shipment tracking & customer portal',
  'Invoices, payments & documents',
  'Notifications',
  'Owner/manager analytics',
  'Staff accounts & role-based permissions',
  'AI Training & Support Agent',
];

const PLAN_FEATURES: Record<SaasPlanSummary['key'], string[]> = {
  WEBSITE_ONLY: WEBSITE_ONLY_FEATURES,
  SOFTWARE_ONLY: [
    'Customer management',
    'Shipment management',
    'Warehouse receiving & barcode/QR label workflow',
    'Processing / inspection',
    'Container loading & management',
    'Manifest management',
    'Ocean, Air, and RoRo workflows',
    'Destination receiving, pickup & delivery',
    'Public shipment tracking & customer portal',
    'Invoices, payments & documents',
    'Notifications',
    'Owner/manager analytics',
    'Staff accounts & role-based permissions',
    'AI Training & Support Agent',
  ],
  WEBSITE_AND_SOFTWARE: ['Everything in Website Only', 'Everything in Software Only', 'One vendor, one bill, fully connected'],
  SOFTWARE_AND_WEBSITE_BASIC: SOFTWARE_AND_WEBSITE_FEATURES,
  SOFTWARE_AND_WEBSITE_PROFESSIONAL: SOFTWARE_AND_WEBSITE_FEATURES,
};

const PLAN_CTA_LABELS: Record<SaasPlanSummary['key'], string> = {
  WEBSITE_ONLY: 'Get Started',
  SOFTWARE_ONLY: 'Start Your Company',
  WEBSITE_AND_SOFTWARE: 'Start Your Company',
  SOFTWARE_AND_WEBSITE_BASIC: 'Start Your Company',
  SOFTWARE_AND_WEBSITE_PROFESSIONAL: 'Start Your Company',
};

export default function AnanseLogixPricingPage() {
  const [plans, setPlans] = useState<SaasPlanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPublicPlans()
      .then(setPlans)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load pricing'));
  }, []);

  return (
    <>
      <PageHero
        kicker="Pricing"
        title="Website only, or the complete platform"
        description="Simple plans for logistics companies of any size. Pricing is configured by our team and reflects what's currently active — nothing here is hardcoded."
      />
      <Container className="py-16 lg:py-20">
        {error && (
          <p role="alert" className="text-center text-sm text-red-600">
            {error}
          </p>
        )}
        {!error && !plans && <p className="text-center text-sm text-slate-500">Loading pricing…</p>}
        {!error && plans && plans.length === 0 && (
          <p className="text-center text-sm text-slate-500">
            Pricing has not been configured yet — please{' '}
            <Link href="/ananselogix/demo" className="font-medium text-primary-700">
              request a demo
            </Link>{' '}
            and we&apos;ll work out a plan with you directly.
          </p>
        )}
        {!error && plans && plans.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
              {plans.map((plan) => (
                <Card key={plan.id} className="flex flex-col">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-600">
                    {PLAN_DISPLAY_NAMES[plan.key]}
                  </p>
                  <h3 className="mt-2 font-display text-xl font-bold text-slate-900">{plan.name}</h3>
                  <p className="mt-2 text-sm text-slate-600">{plan.description ?? PLAN_BLURBS[plan.key]}</p>

                  {plan.price ? (
                    <div className="mt-6">
                      {plan.price.isPromoCurrentlyActive && plan.price.promoLabel && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">{plan.price.promoLabel}</p>
                      )}
                      <p className="mt-1 flex items-baseline gap-2">
                        <span className="font-display text-3xl font-bold text-slate-900">
                          {formatCents(plan.price.effectiveMonthlyAmountCents, plan.price.currency)}
                        </span>
                        <span className="text-sm text-slate-500">/month</span>
                      </p>
                      {plan.price.isPromoCurrentlyActive && (
                        <p className="text-xs text-slate-400 line-through">
                          {formatCents(plan.price.monthlyAmountCents, plan.price.currency)}/month
                        </p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        + {formatCents(plan.price.effectiveSetupFeeCents, plan.price.currency)} one-time setup fee
                        {plan.price.isPromoCurrentlyActive && plan.price.effectiveSetupFeeCents !== plan.price.setupFeeCents && (
                          <span className="text-slate-400 line-through"> ({formatCents(plan.price.setupFeeCents, plan.price.currency)})</span>
                        )}
                      </p>
                      {plan.price.trialDays > 0 && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-accent-600">
                          <IconCheckCircle className="h-4 w-4" />
                          {plan.price.trialDays}-day free trial
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-6 text-sm text-slate-500">Pricing coming soon — contact us for details.</p>
                  )}

                  <ul className="mt-6 flex flex-col gap-2 border-t border-slate-100 pt-6 text-sm text-slate-600">
                    {PLAN_FEATURES[plan.key].map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8 flex-1" />
                  <LinkButton href={`/ananselogix/signup?plan=${plan.key}`} variant="secondary" className="justify-center">
                    {PLAN_CTA_LABELS[plan.key]}
                  </LinkButton>
                </Card>
              ))}
            </div>

            <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-slate-500">
              Setup fees are billed once, at signup. Monthly subscription fees recur every month for as long as your
              account is active — there are no other hidden charges.
            </p>
          </>
        )}
      </Container>
    </>
  );
}
