import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

/**
 * Descriptive/logistical field updates only — deliberately excludes
 * `status`. Shipment status only ever changes via a tracking event (see
 * CreateTrackingEventDto), never a raw PATCH, so status history can never
 * be silently overwritten.
 */
export class UpdateShipmentDto {
  @IsOptional()
  @IsString()
  originLocation?: string;

  @IsOptional()
  @IsString()
  destinationLocation?: string;

  @IsOptional()
  @IsString()
  originWarehouseId?: string;

  @IsOptional()
  @IsString()
  destinationWarehouseId?: string;

  @IsOptional()
  @IsString()
  routeId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  declaredValue?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
