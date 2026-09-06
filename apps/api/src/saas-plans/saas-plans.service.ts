import { Injectable, NotFoundException } from '@nestjs/common';
import { SaasPlanPrice } from '@prisma/client';
import type { SaasPlanPriceSummary, SaasPlanSummary } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaasPlanPriceDto } from './dto/create-saas-plan-price.dto';
import { CreateSaasPlanDto } from './dto/create-saas-plan.dto';
import { UpdateSaasPlanDto } from './dto/update-saas-plan.dto';
import { effectivePrice } from './promo-pricing.util';

/**
 * AnanseLogix Phase 1: plan/price management. Pricing is deliberately
 * data, not frontend constants (Section 4 of the build brief) — the
 * signup wizard's Stripe Checkout line items are always built from
 * whatever this table's current active row says, never a hardcoded
 * number (see StripeService.createSubscriptionCheckoutSession's caller in
 * SignupService).
 */
@Injectable()
export class SaasPlansService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /public/plans — active plans only, each with its currently-effective price (or null if none configured yet). Never fabricates a price. */
  async findAllPublic(): Promise<SaasPlanSummary[]> {
    const plans = await this.prisma.saasPlan.findMany({
      where: { isActive: true },
      include: { prices: { where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });
    return plans.map((plan) => ({
      id: plan.id,
      key: plan.key as unknown as SaasPlanSummary['key'],
      name: plan.name,
      description: plan.description,
      price: plan.prices[0] ? this.toPriceSummary(plan.prices[0]) : null,
    }));
  }

  /** PLATFORM_ADMIN only — every plan and every price row (including inactive/historical), for the /platform/plans management UI. */
  async findAllForAdmin() {
    return this.prisma.saasPlan.findMany({
      include: { prices: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createPlan(dto: CreateSaasPlanDto) {
    return this.prisma.saasPlan.create({ data: dto });
  }

  async updatePlan(id: string, dto: UpdateSaasPlanDto) {
    await this.requirePlan(id);
    return this.prisma.saasPlan.update({ where: { id }, data: dto });
  }

  /**
   * Adds a new price row and — since exactly one row per (planId, interval)
   * should be active at a time (see SaasPlanPrice's own doc comment) —
   * deactivates every other currently-active row for that plan/interval in
   * the same transaction, so "make this one active" can never leave two
   * active rows behind even under a concurrent request.
   */
  async createPrice(planId: string, dto: CreateSaasPlanPriceDto) {
    await this.requirePlan(planId);
    return this.prisma.$transaction(async (tx) => {
      await tx.saasPlanPrice.updateMany({
        where: { planId, interval: 'MONTH', isActive: true },
        data: { isActive: false },
      });
      return tx.saasPlanPrice.create({
        data: {
          planId,
          currency: dto.currency ?? 'usd',
          setupFeeCents: dto.setupFeeCents,
          monthlyAmountCents: dto.monthlyAmountCents,
          trialDays: dto.trialDays ?? 0,
          promoLabel: dto.promoLabel,
          promoSetupFeeCents: dto.promoSetupFeeCents,
          promoMonthlyAmountCents: dto.promoMonthlyAmountCents,
          promoStartsAt: dto.promoStartsAt ? new Date(dto.promoStartsAt) : undefined,
          promoEndsAt: dto.promoEndsAt ? new Date(dto.promoEndsAt) : undefined,
          promoIsActive: dto.promoIsActive ?? false,
          promoMaxRedemptions: dto.promoMaxRedemptions,
          isFoundingOffer: dto.isFoundingOffer ?? false,
          isActive: true,
        },
      });
    });
  }

  async deactivatePrice(planId: string, priceId: string) {
    const price = await this.prisma.saasPlanPrice.findFirst({ where: { id: priceId, planId } });
    if (!price) {
      throw new NotFoundException('Price not found');
    }
    return this.prisma.saasPlanPrice.update({ where: { id: priceId }, data: { isActive: false } });
  }

  /** Internal helper — resolves a plan's currently-active price for a given SaasPlanType, used by SignupService when building the Checkout Session. */
  async findActivePriceForPlanKey(planId: string): Promise<SaasPlanPrice | null> {
    return this.prisma.saasPlanPrice.findFirst({ where: { planId, isActive: true }, orderBy: { createdAt: 'desc' } });
  }

  private async requirePlan(id: string) {
    const plan = await this.prisma.saasPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  private toPriceSummary(price: SaasPlanPrice): SaasPlanPriceSummary {
    const effective = effectivePrice(price);

    return {
      id: price.id,
      interval: price.interval as unknown as SaasPlanPriceSummary['interval'],
      currency: price.currency,
      setupFeeCents: price.setupFeeCents,
      monthlyAmountCents: price.monthlyAmountCents,
      trialDays: price.trialDays,
      promoLabel: price.promoLabel,
      promoSetupFeeCents: price.promoSetupFeeCents,
      promoMonthlyAmountCents: price.promoMonthlyAmountCents,
      promoStartsAt: price.promoStartsAt?.toISOString() ?? null,
      promoEndsAt: price.promoEndsAt?.toISOString() ?? null,
      promoIsActive: price.promoIsActive,
      promoMaxRedemptions: price.promoMaxRedemptions,
      promoRedemptionCount: price.promoRedemptionCount,
      isFoundingOffer: price.isFoundingOffer,
      isPromoCurrentlyActive: effective.isPromoActive,
      effectiveSetupFeeCents: effective.setupFeeCents,
      effectiveMonthlyAmountCents: effective.monthlyAmountCents,
    };
  }
}
