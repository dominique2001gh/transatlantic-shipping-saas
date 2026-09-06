import { IsBoolean, IsDateString, IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator';

/**
 * interval is deliberately omitted — BillingInterval currently has exactly
 * one value (MONTH), see that enum's own doc comment; every price this
 * endpoint creates is monthly until annual billing (Section 4's "future
 * annual billing capability") is actually built.
 */
export class CreateSaasPlanPriceDto {
  @IsOptional()
  @IsString()
  currency?: string;

  @IsInt()
  @Min(0)
  setupFeeCents!: number;

  @IsInt()
  @IsPositive()
  monthlyAmountCents!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  trialDays?: number;

  @IsOptional()
  @IsString()
  promoLabel?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  promoSetupFeeCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  promoMonthlyAmountCents?: number;

  @IsOptional()
  @IsDateString()
  promoStartsAt?: string;

  @IsOptional()
  @IsDateString()
  promoEndsAt?: string;

  /** The admin's own on/off switch for the promo — see SaasPlanPrice.promoIsActive's own schema doc comment. Defaults to false: setting promo amounts alone never silently turns a promo on. */
  @IsOptional()
  @IsBoolean()
  promoIsActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  promoMaxRedemptions?: number;

  @IsOptional()
  @IsBoolean()
  isFoundingOffer?: boolean;
}
