import { Type } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { ShipmentItemType, ShipmentMode, WebsiteLeadType } from '@prisma/client';

/**
 * QUOTE_REQUEST-only structured shipment details — see WebsiteLead's own
 * doc comment (schema.prisma) for why this is a flexible nested object
 * rather than dedicated columns. Every field optional: a visitor may
 * leave any of these blank, and this is never validated into a real
 * Shipment — it's purely a staff-readable record of what was typed.
 */
export class WebsiteLeadQuoteDetailsDto {
  @IsOptional()
  @IsString()
  originCountry?: string;

  @IsOptional()
  @IsString()
  originCity?: string;

  @IsOptional()
  @IsString()
  destinationCountry?: string;

  @IsOptional()
  @IsString()
  destinationCity?: string;

  @IsOptional()
  @IsEnum(ShipmentMode)
  shipmentMode?: ShipmentMode;

  @IsOptional()
  @IsEnum(ShipmentItemType)
  itemType?: ShipmentItemType;

  @IsOptional()
  @IsString()
  approximateWeight?: string;

  @IsOptional()
  @IsString()
  length?: string;

  @IsOptional()
  @IsString()
  width?: string;

  @IsOptional()
  @IsString()
  height?: string;
}

/**
 * POST /public/leads. `tenantSlug` identifies which tenant's marketing
 * site this came from — the same pattern GET /tracking/public already
 * uses (see TrackingController), since there is no authenticated session
 * on a public form to derive it from otherwise.
 */
export class CreateLeadDto {
  @IsString()
  @MinLength(1)
  tenantSlug!: string;

  @IsEnum(WebsiteLeadType)
  type!: WebsiteLeadType;

  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WebsiteLeadQuoteDetailsDto)
  quoteDetails?: WebsiteLeadQuoteDetailsDto;
}
