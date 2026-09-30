import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Warehouse Location Management: same required-field shape as onboarding's
 * own OnboardingWarehouseInputDto (name/code/addressLine1/city/country),
 * plus the remaining optional Warehouse columns (addressLine2/state/
 * postalCode/phone) a real settings form should also collect. Deliberately
 * has no `tenantId` field — WarehouseController always derives it from the
 * caller's own verified JWT (see requireTenantId), never a client-supplied
 * value, so there is no way to create a warehouse under another tenant.
 *
 * `isOriginWarehouse`/`isDestinationWarehouse` are independent booleans,
 * not a single enum — a warehouse may be neither, either, or both, exactly
 * matching the existing Warehouse model (see schema.prisma's own comment)
 * and every existing tenant's own rows. Never hard-codes which one a new
 * warehouse should be; the caller (a real OWNER/MANAGER configuring their
 * own tenant) decides.
 */
export class CreateWarehouseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  country!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isOriginWarehouse?: boolean;

  @IsOptional()
  @IsBoolean()
  isDestinationWarehouse?: boolean;
}
