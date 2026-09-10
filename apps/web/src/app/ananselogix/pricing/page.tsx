'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconCheckCircle, IconChevronDown } from '@/components/icons';
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
  SOFTWARE_AND_WEBSITE_BASIC: 'The core AnanseLogix platform — a branded website plus everyday shipment, warehouse, and customer operations.',
  SOFTWARE_AND_WEBSITE_PROFESSIONAL: 'Everything in Basic, plus the AI assistant, advanced analytics, and early access to what comes next.',
};

/**
 * Website Only shows ONLY website-related items — never operations
 * software, tracking, customer portal, invoices, or analytics, so this
 * plan can never look like it includes the SaaS operations platform.
 */
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
 * The real, code-enforced Basic bundle — see plan-entitlements.ts's
 * SOFTWARE_AND_WEBSITE_BASIC row. Deliberately excludes AI_AGENT and
 * ANALYTICS (both real @RequireEntitlement()-gated features a Basic
 * tenant's API calls are actually rejected from) and everything below that
 * has no dedicated entitlement of its own yet — see PROFESSIONAL_ONLY_FEATURES'
 * own comment for why those are described as "early access," not as a
 * present, plan-gated restriction.
 */
const BASIC_FEATURES: string[] = [
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
  'Invoices & customer payments',
  'Notifications',
  'Operational dashboard',
  'Staff accounts & role-based access',
];

/**
 * What Professional actually adds beyond Basic today. AI_AGENT and
 * ANALYTICS are real, code-enforced entitlements — a Basic tenant's own
 * API calls to those features are rejected server-side, not just hidden in
 * the UI. "Early access to future platform capabilities" is honest
 * forward-looking language, not a claim about anything that exists today
 * (see AI_AGENT's own scope: Q&A only, no action-taking, in every plan).
 *
 * Several differentiators requested for Professional — a dedicated
 * document center, bulk customer/disruption messaging, a narrower staff
 * permission model, and plan-gated multi-location controls — are NOT yet
 * backed by their own entitlement or any code-level restriction: every
 * tenant with OPERATIONS_SOFTWARE gets the same documents, notifications,
 * staff roles, and multi-warehouse support today. They are intentionally
 * left off this list rather than advertised as real today; see the
 * ADVANCED_FEATURES flag in plan-entitlements.ts, which is set for
 * Professional but not yet checked by any guard.
 */
const PROFESSIONAL_ONLY_FEATURES: string[] = [
  'AI Training & Support Agent',
  'Advanced owner/manager analytics & reports',
  'Early access to future platform capabilities',
];

const PLAN_FEATURES: Record<SaasPlanSummary['key'], string[]> = {
  WEBSITE_ONLY: WEBSITE_ONLY_FEATURES,
  SOFTWARE_ONLY: BASIC_FEATURES,
  WEBSITE_AND_SOFTWARE: [...BASIC_FEATURES, ...PROFESSIONAL_ONLY_FEATURES],
  SOFTWARE_AND_WEBSITE_BASIC: BASIC_FEATURES,
  SOFTWARE_AND_WEBSITE_PROFESSIONAL: [...PROFESSIONAL_ONLY_FEATURES, ...BASIC_FEATURES],
};

/** How many features each card shows before "View all features". Keeps every card approximately the same height regardless of its full list length. */
const INITIAL_FEATURE_COUNT = 7;

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
                <PlanCard key={plan.id} plan={plan} />
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

function PlanCard({ plan }: { plan: SaasPlanSummary }) {
  const [expanded, setExpanded] = useState(false);
  const features = PLAN_FEATURES[plan.key];
  const visibleFeatures = expanded ? features : features.slice(0, INITIAL_FEATURE_COUNT);
  const hasMore = features.length > INITIAL_FEATURE_COUNT;

  return (
    <Card className="flex flex-col">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-600">{PLAN_DISPLAY_NAMES[plan.key]}</p>
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
            <p className="text-xs text-slate-400 line-through">{formatCents(plan.price.monthlyAmountCents, plan.price.currency)}/month</p>
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
        {visibleFeatures.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            {feature}
          </li>
        ))}
      </ul>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-3 flex items-center gap-1.5 self-start text-sm font-medium text-primary-700 hover:text-primary-800"
        >
          {expanded ? 'Show less' : 'View all features'}
          <IconChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}

      <div className="mt-6 flex-1" />
      <LinkButton href={`/ananselogix/signup?plan=${plan.key}`} variant="secondary" className="mt-2 justify-center">
        {PLAN_CTA_LABELS[plan.key]}
      </LinkButton>
    </Card>
  );
}
