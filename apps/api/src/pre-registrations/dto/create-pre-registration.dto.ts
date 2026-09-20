import { ShipmentItemType, ShipmentMode } from '@transatlantic/shared';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/**
 * Customer Self-Service Pre-Registration, Stage 1: every field is optional
 * — a DRAFT is meant to be startable with as little or as much information
 * as the customer has on hand, then filled in over time via update() before
 * submit(). Deliberately the same recipient-block shape QuickReceiveDto/
 * CreateShipmentDto already use, so mapping a submitted pre-registration
 * into Quick Receive in a later stage is a near-direct field copy, not a
 * translation. `customerId`/`tenantId`/`status`/`referenceNumber` are never
 * client-supplied — the service derives them from the authenticated
 * customer's own JWT and the record's own lifecycle.
 */
export class CreatePreRegistrationDto {
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

  /** Approximate piece count the customer expects to drop off — not a per-item declaration, see ShipmentItem for that level of detail post-conversion. */
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
