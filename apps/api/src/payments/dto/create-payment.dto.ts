import { PaymentMethod } from '@transatlantic/shared';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

/**
 * Stage 3B: manual payment recording only. Deliberately has NO
 * `invoiceId`/`customerId`/`tenantId`/`currency` fields — `invoiceId`
 * comes from the route param, and customerId/currency/tenantId are always
 * derived server-side from the invoice itself in PaymentsService, never
 * accepted as request input. This makes "attribute a payment to the
 * wrong customer/tenant via a manipulated id" structurally impossible,
 * not just checked.
 */
export class CreatePaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  /** Defaults to now() in PaymentsService if omitted. */
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
