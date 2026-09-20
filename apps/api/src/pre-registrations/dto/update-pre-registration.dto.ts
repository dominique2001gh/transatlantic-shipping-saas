import { ShipmentItemType, ShipmentMode } from '@transatlantic/shared';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/**
 * Customer Self-Service Pre-Registration, Stage 1: identical field list to
 * CreatePreRegistrationDto (kept as its own explicit class rather than a
 * PartialType wrapper, matching this codebase's existing DTO convention —
 * see UpdatePortalProfileDto). PreRegistrationsService.update() only ever
 * applies this to a DRAFT record — see that method's own doc comment for
 * why editing is intentionally not extended to SUBMITTED in Stage 1.
 */
export class UpdatePreRegistrationDto {
  @IsOptional()
  @IsEnum(ShipmentMode)
  shipmentMode?: ShipmentMode;

  @IsOptional()
  @IsString()
  @MinLength(1)
  destinationCountry?: string;

  @IsOptional()
  @IsString()
  destinationLocation?: string;

  @IsOptional()
  @IsEnum(ShipmentItemType)
  itemType?: ShipmentItemType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  packageCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  recipientPhone?: string;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  recipientAddressLine1?: string;

  @IsOptional()
  @IsString()
  recipientAddressLine2?: string;

  @IsOptional()
  @IsString()
  recipientCity?: string;

  @IsOptional()
  @IsString()
  recipientState?: string;

  @IsOptional()
  @IsString()
  recipientCountry?: string;

  @IsOptional()
  @IsString()
  recipientPostalCode?: string;
}
