import { DimensionUnit, ShipmentItemType, ShipmentMode, WeightUnit } from '@transatlantic/shared';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Quick Receive (Phase 1): one request that does what New Shipment + N
 * trips through Warehouse -> Receive used to take. `packageCount` replaces
 * the explicit `items[]` array CreateShipmentDto takes — every generated
 * item shares the same optional physical defaults (itemType/weight/
 * dimensions/declaredValue) given here; a single odd-one-out package is
 * still editable afterward via the existing
 * PATCH /shipments/:id/items/:itemId, unchanged by this feature.
 *
 * `originWarehouseId` is required here (unlike CreateShipmentDto, where
 * it's optional) — Quick Receive's entire point is "these pieces are
 * physically at this warehouse right now," so there is no meaningful
 * default to fall back to.
 *
 * Same 1-50 ceiling as CreateShipmentDto's `items` array
 * (`@ArrayMaxSize(50)`) — chosen for the same reason: a sane upper bound
 * for a single warehouse-floor action and for the size of the one
 * transaction ShipmentsService.createQuickReceive runs.
 */
export class QuickReceiveDto {
  @IsString()
  customerId!: string;

  @IsEnum(ShipmentMode)
  shipmentMode!: ShipmentMode;

  @IsString()
  @MinLength(1)
  originCountry!: string;

  @IsString()
  @MinLength(1)
  destinationCountry!: string;

  @IsOptional()
  @IsString()
  originLocation?: string;

  @IsOptional()
  @IsString()
  destinationLocation?: string;

  @IsString()
  originWarehouseId!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  @Max(50)
  packageCount!: number;

  /** Applied to every generated item. Defaults to BOX in the service if omitted. */
  @IsOptional()
  @IsEnum(ShipmentItemType)
  itemType?: ShipmentItemType;

  /** Applied to every generated item (e.g. "Household goods, mixed boxes"). */
  @IsOptional()
  @IsString()
  itemDescription?: string;

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

  @IsOptional()
  @IsNumber()
  @IsPositive()
  declaredValue?: number;

  /** Recorded on each item's receiving TrackingEvent, same field ReceiveItemDto already exposes. */
  @IsOptional()
  @IsString()
  notes?: string;
}
