'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { SaasPlanType } from '@transatlantic/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectInput, TextInput } from '@/components/forms/FormField';
import { ApiError } from '@/lib/api';
import { addPlanPrice, createPlan, fetchAdminPlans, type AdminSaasPlan } from '@/lib/ananselogix/admin-plans';
import { formatCents } from '@/lib/ananselogix/plans';

const PLAN_TYPES = Object.values(SaasPlanType);

export default function PlatformPlansPage() {
  const [plans, setPlans] = useState<AdminSaasPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function load() {
    fetchAdminPlans()
      .then(setPlans)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load plans'));
  }

  useEffect(load, []);

  async function handleCreatePlan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await createPlan({
        key: String(form.get('key')) as SaasPlanType,
        name: String(form.get('name') ?? ''),
        description: String(form.get('description') ?? '') || undefined,
      });
      e.currentTarget.reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create plan');
    } finally {
      setCreating(false);
    }
  }

  async function handleAddPrice(planId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await addPlanPrice(planId, {
        setupFeeCents: Number(form.get('setupFeeCents') ?? 0),
        monthlyAmountCents: Number(form.get('monthlyAmountCents') ?? 0),
        trialDays: Number(form.get('trialDays') ?? 0),
        promoLabel: String(form.get('promoLabel') ?? '') || undefined,
        promoSetupFeeCents: form.get('promoSetupFeeCents') ? Number(form.get('promoSetupFeeCents')) : undefined,
        promoMonthlyAmountCents: form.get('promoMonthlyAmountCents') ? Number(form.get('promoMonthlyAmountCents')) : undefined,
        promoStartsAt: String(form.get('promoStartsAt') ?? '') || undefined,
        promoEndsAt: String(form.get('promoEndsAt') ?? '') || undefined,
        promoIsActive: form.get('promoIsActive') === 'on',
        promoMaxRedemptions: form.get('promoMaxRedemptions') ? Number(form.get('promoMaxRedemptions')) : undefined,
        isFoundingOffer: form.get('isFoundingOffer') === 'on',
      });
      e.currentTarget.reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add price');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Plans &amp; Pricing</h1>
      <p className="mt-1 text-sm text-slate-500">
        Configure the plans and prices shown on the public pricing page and signup wizard. Adding a price always
        creates a new row and deactivates the previous one — pricing history is never overwritten in place.
      </p>

      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}

      <Card className="mt-6">
        <h2 className="font-display text-base font-semibold text-slate-900">Add a new plan</h2>
        <form onSubmit={handleCreatePlan} className="mt-4 flex flex-wrap items-end gap-4">
          <div className="w-56">
            <SelectInput label="Plan type" id="key" name="key" defaultValue={SaasPlanType.WEBSITE_ONLY}>
              {PLAN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll('_', ' ')}
                </option>
              ))}
            </SelectInput>
          </div>
          <div className="flex-1 min-w-[200px]">
            <TextInput label="Display name" id="name" name="name" required />
          </div>
          <div className="flex-1 min-w-[200px]">
            <TextInput label="Description" id="description" name="description" />
          </div>
          <Button type="submit" disabled={creating}>
            Add Plan
          </Button>
        </form>
      </Card>

      <div className="mt-8 flex flex-col gap-6">
        {plans?.map((plan) => (
          <Card key={plan.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">{plan.key.replaceAll('_', ' ')}</p>
                <h3 className="font-display text-lg font-semibold text-slate-900">{plan.name}</h3>
              </div>
              <Badge variant={plan.isActive ? 'success' : 'neutral'}>{plan.isActive ? 'Active' : 'Inactive'}</Badge>
            </div>

            <table className="mt-4 w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1 pr-4 font-medium">Monthly</th>
                  <th className="py-1 pr-4 font-medium">Setup fee</th>
                  <th className="py-1 pr-4 font-medium">Trial</th>
                  <th className="py-1 pr-4 font-medium">Promo</th>
                  <th className="py-1 pr-4 font-medium">Promo window</th>
                  <th className="py-1 pr-4 font-medium">Redeemed</th>
                  <th className="py-1 font-medium">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plan.prices.map((price) => (
                  <tr key={price.id}>
                    <td className="py-2 pr-4">{formatCents(price.monthlyAmountCents, price.currency)}</td>
                    <td className="py-2 pr-4">{formatCents(price.setupFeeCents, price.currency)}</td>
                    <td className="py-2 pr-4">{price.trialDays} days</td>
                    <td className="py-2 pr-4">
                      {price.promoLabel ? (
                        <span>
                          {price.promoLabel}
                          {price.promoIsActive ? (
                            <Badge variant="success">On</Badge>
                          ) : (
                            <Badge>Off</Badge>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-500">
                      {price.promoStartsAt || price.promoEndsAt
                        ? `${price.promoStartsAt ? new Date(price.promoStartsAt).toLocaleDateString() : '…'} – ${price.promoEndsAt ? new Date(price.promoEndsAt).toLocaleDateString() : '…'}`
                        : '—'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-500">
                      {price.promoLabel ? `${price.promoRedemptionCount}${price.promoMaxRedemptions ? ` / ${price.promoMaxRedemptions}` : ''}` : '—'}
                    </td>
                    <td className="py-2">{price.isActive ? <Badge variant="success">Yes</Badge> : <Badge>No</Badge>}</td>
                  </tr>
                ))}
                {plan.prices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-3 text-slate-400">
                      No pricing configured yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <form onSubmit={(e) => handleAddPrice(plan.id, e)} className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Standard price</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-32">
                  <TextInput label="Monthly (¢)" id={`monthly-${plan.id}`} name="monthlyAmountCents" type="number" placeholder="cents" required />
                </div>
                <div className="w-32">
                  <TextInput label="Setup fee (¢)" id={`setup-${plan.id}`} name="setupFeeCents" type="number" defaultValue={0} />
                </div>
                <div className="w-24">
                  <TextInput label="Trial days" id={`trial-${plan.id}`} name="trialDays" type="number" defaultValue={0} />
                </div>
              </div>

              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Promotional override (optional — e.g. a Founding Partner offer)
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <TextInput label="Promo label" id={`promo-${plan.id}`} name="promoLabel" placeholder="Founding Partner" />
                </div>
                <div className="w-32">
                  <TextInput label="Promo setup (¢)" id={`promosetup-${plan.id}`} name="promoSetupFeeCents" type="number" />
                </div>
                <div className="w-32">
                  <TextInput label="Promo monthly (¢)" id={`promoamt-${plan.id}`} name="promoMonthlyAmountCents" type="number" />
                </div>
                <div className="w-40">
                  <TextInput label="Promo starts" id={`promostart-${plan.id}`} name="promoStartsAt" type="date" />
                </div>
                <div className="w-40">
                  <TextInput label="Promo ends" id={`promoend-${plan.id}`} name="promoEndsAt" type="date" />
                </div>
                <div className="w-28">
                  <TextInput label="Max redemptions" id={`promomax-${plan.id}`} name="promoMaxRedemptions" type="number" placeholder="Unlimited" />
                </div>
                <label className="flex items-center gap-2 pb-2.5 text-sm font-medium text-slate-700">
                  <input type="checkbox" name="promoIsActive" className="h-4 w-4 rounded border-slate-300 text-primary-700 focus:ring-primary-500" />
                  Promo active
                </label>
                <label className="flex items-center gap-2 pb-2.5 text-sm font-medium text-slate-700">
                  <input type="checkbox" name="isFoundingOffer" className="h-4 w-4 rounded border-slate-300 text-primary-700 focus:ring-primary-500" />
                  Founding offer
                </label>
              </div>

              <div>
                <Button type="submit" size="sm">
                  Set Active Price
                </Button>
              </div>
            </form>
          </Card>
        ))}
      </div>
    </div>
  );
}
