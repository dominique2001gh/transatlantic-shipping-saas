import { DimensionUnit, ItemProcessingResult, ShipmentItemCondition, WeightUnit } from '@transatlantic/shared';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

/**
 * Records one warehouse inspection/processing pass over a received item.
 * Business rules (e.g. "a damaged item can't be marked READY", "exception
 * description is required when hasException is true") are enforced in
 * WarehouseService.processItem, not here — this DTO only validates shape,
 * matching how ReceiveItemDto/CreateShipmentDto keep cross-field rules in
 * the service layer.
 */
export class ProcessItemDto {
  /** Must match the item's current physical location (ShipmentItem.currentWarehouseId). */
  @IsString()
  warehouseId!: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  weight?: number;

  @IsOptional()
  @IsEnum(WeightUnit)
  weightUnit?: WeightUnit;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  length?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  width?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  height?: number;

  @IsOptional()
  @IsEnum(DimensionUnit)
  dimensionUnit?: DimensionUnit;

  @IsEnum(ShipmentItemCondition)
  condition!: ShipmentItemCondition;

  @IsEnum(ItemProcessingResult)
  result!: ItemProcessingResult;

  /** Damage/exception indicator — independent of `condition` (e.g. missing paperwork on an otherwise GOOD item). */
  @IsOptional()
  @IsBoolean()
  hasException?: boolean;

  /** Required by the service when hasException is true. */
  @IsOptional()
  @IsString()
  exceptionDescription?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Same provenance pattern as ReceiveItemDto: server maps this to the real TrackingEventSource. */
  @IsBoolean()
  scanned!: boolean;

  @IsOptional()
  @IsString()
  scanIdentifier?: string;

  /**
   * Explicit, deliberate opt-in to reprocess an item that has already been
   * PROCESSED or put on EXCEPTION/HOLD. Omitted/false means "first-time
   * processing"; the server rejects (409) a first-time-shaped request
   * against an already-processed item so an accidental duplicate scan can
   * never silently create a second inspection record.
   */
  @IsOptional()
  @IsBoolean()
  reinspection?: boolean;
}
