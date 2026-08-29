import { ShipmentMode } from '@transatlantic/shared';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * `manifestNumber` is server-generated (see generateManifestNumber), not
 * accepted here — an internal reference number, unlike containerNumber
 * which is staff-entered because real ISO container numbers are assigned
 * externally.
 *
 * Milestone 3E-A scope: create/list/detail only. Nothing here validates
 * vessel/voyage vs. flight fields against `shipmentMode` yet (e.g.
 * rejecting a flightNumber on an OCEAN manifest) — that belongs with the
 * assignment/eligibility rules in the next controlled step, to keep this
 * foundation narrow.
 */
export class CreateManifestDto {
  @IsEnum(ShipmentMode)
  shipmentMode!: ShipmentMode;

  @IsOptional()
  @IsString()
  originWarehouseId?: string;

  @IsOptional()
  @IsString()
  routeId?: string;

  @IsOptional()
  @IsString()
  originLocation?: string;

  @IsOptional()
  @IsString()
  destinationLocation?: string;

  @IsOptional()
  @IsString()
  carrierName?: string;

  @IsOptional()
  @IsString()
  vesselName?: string;

  @IsOptional()
  @IsString()
  voyageNumber?: string;

  @IsOptional()
  @IsString()
  flightNumber?: string;

  @IsOptional()
  @IsDateString()
  plannedDepartureAt?: string;

  @IsOptional()
  @IsDateString()
  estimatedArrivalAt?: string;
}
