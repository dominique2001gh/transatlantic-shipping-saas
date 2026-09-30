import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Warehouse Location Management: PATCH semantics — every field optional,
 * only what's sent is changed (see WarehouseService.updateWarehouse). The
 * primary use today is fixing a warehouse's isOriginWarehouse/
 * isDestinationWarehouse/isActive flags after the fact (the "manage" half
 * of this feature, alongside CreateWarehouseDto's "create" half) — the
 * remaining fields exist for completeness/future editing, not because the
 * current UI sends them yet.
 */
export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  country?: string;

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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
