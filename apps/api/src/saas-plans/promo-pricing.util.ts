import { SaasPlanPrice } from '@prisma/client';

/**
 * AnanseLogix: the single authoritative definition of "is this price's
 * promo currently in effect" and "what does it actually cost right now" —
 * used identically by SaasPlansService (public/admin display),
 * SignupService (what Stripe Checkout actually charges), and
 * SubscriptionsService/TenantProvisioningService (redemption counting).
 * Deliberately one function: a promo that displays as active on the
 * pricing page but charges the standard price at checkout (or vice versa)
 * would be a real, user-visible bug, and the only way to guarantee that
 * never happens is to never compute this twice.
 *
 * A promo requires ALL of: the admin's own on/off switch
 * (promoIsActive), a configured promo monthly amount, being inside the
 * optional date window, and — if a redemption cap is set — still being
 * under it. Once any one of these fails, every effective* field silently
 * falls back to the standard amount; the plan itself is still
 * purchasable, just no longer at the promo rate (see promoMaxRedemptions'
 * own schema doc comment).
 */
export function isPromoActive(price: SaasPlanPrice, now: Date = new Date()): boolean {
  if (!price.promoIsActive || price.promoMonthlyAmountCents == null) return false;
  if (price.promoStartsAt && price.promoStartsAt > now) return false;
  if (price.promoEndsAt && price.promoEndsAt < now) return false;
  if (price.promoMaxRedemptions != null && price.promoRedemptionCount >= price.promoMaxRedemptions) return false;
  return true;
}

export interface EffectivePrice {
  isPromoActive: boolean;
  setupFeeCents: number;
  monthlyAmountCents: number;
}

export function effectivePrice(price: SaasPlanPrice, now: Date = new Date()): EffectivePrice {
  const promoActive = isPromoActive(price, now);
  return {
    isPromoActive: promoActive,
    setupFeeCents: promoActive && price.promoSetupFeeCents != null ? price.promoSetupFeeCents : price.setupFeeCents,
    monthlyAmountCents: promoActive ? price.promoMonthlyAmountCents! : price.monthlyAmountCents,
  };
}
