import { DimensionUnit, ShipmentItemCondition, ShipmentItemType, WeightUnit } from '@transatlantic/shared';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * Descriptive/physical attribute updates only — deliberately excludes
 * `status`. Item status only ever changes via a tracking event (see
 * CreateTrackingEventDto.itemStatus), so history is never silently
 * overwritten by an edit form.
 */
export class UpdateShipmentItemDto {
  @IsOptional()
  @IsEnum(ShipmentItemType)
  itemType?: ShipmentItemType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  length?: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsEnum(DimensionUnit)
  dimensionUnit?: DimensionUnit;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsEnum(WeightUnit)
  weightUnit?: WeightUnit;

  @IsOptional()
  @IsNumber()
  declaredValue?: number;

  @IsOptional()
  @IsEnum(ShipmentItemCondition)
  condition?: ShipmentItemCondition;

  @IsOptional()
  @IsString()
  externalTrackingCarrier?: string;

  @IsOptional()
  @IsString()
  externalTrackingNumber?: string;
}
