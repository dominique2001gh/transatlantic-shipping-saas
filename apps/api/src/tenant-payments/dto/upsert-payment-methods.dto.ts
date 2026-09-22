import { MANUAL_PAYMENT_METHODS, PaymentMethod } from '@transatlantic/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * Tenant Payment Configuration Phase C/D: one row of a tenant's manual-
 * payment-method configuration. `@IsIn(MANUAL_PAYMENT_METHODS)` — not
 * `@IsEnum(PaymentMethod)` — is the entire reason CARD can never be
 * written through this endpoint: it's a real PaymentMethod value but not
 * a member of the manual-methods allow-list, so it fails validation here
 * exactly like any garbage string would. `instructions` is free text the
 * tenant authors itself and is never validated/parsed as anything
 * structured — see TenantPaymentMethodConfig's own schema doc comment for
 * why this is deliberately never treated as a credential.
 */
export class PaymentMethodConfigItemDto {
  @IsIn(MANUAL_PAYMENT_METHODS)
  method!: PaymentMethod;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string | null;
}

/** PUT /tenant-payments/methods request body — always the full configurable set, upserted atomically in one transaction. */
export class UpsertPaymentMethodsDto {
  @IsArray()
  @ArrayMaxSize(MANUAL_PAYMENT_METHODS.length)
  @ValidateNested({ each: true })
  @Type(() => PaymentMethodConfigItemDto)
  methods!: PaymentMethodConfigItemDto[];
}
