import { DimensionUnit, ShipmentItemType, ShipmentMode, WeightUnit } from '@transatlantic/shared';
import {
  IsEmail,
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
 *
 * Phase 2: deliberately has no `originCountry`/`originLocation` fields —
 * ShipmentsService.createQuickReceive derives both directly from the
 * selected `originWarehouseId`'s own city/state/country, which is the
 * authoritative record of where a warehouse physically is (see
 * Warehouse in schema.prisma). Origin geography is never client-supplied
 * free text here, so there is no per-tenant default to get wrong.
 * `destinationWarehouseId` is optional and, unlike origin, does not
 * override the staff-entered `destinationCountry`/`destinationLocation` —
 * a shipment's real destination may be a port or airport the tenant
 * hasn't modeled as a Warehouse row at all, and forcing the warehouse's
 * own address onto the shipment would silently overwrite that.
 */
export class QuickReceiveDto {
  @IsString()
  customerId!: string;

  @IsEnum(ShipmentMode)
  shipmentMode!: ShipmentMode;

  @IsString()
  @MinLength(1)
  destinationCountry!: string;

  @IsOptional()
  @IsString()
  destinationLocation?: string;

  @IsString()
  originWarehouseId!: string;

  @IsOptional()
  @IsString()
  destinationWarehouseId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Consignee at destination — required (see Shipment.recipient* doc
   * comment in schema.prisma for why this is captured once here rather
   * than re-asked at every downstream handoff). `recipientPhone` is a
   * plain string with no format/country regex: this platform serves
   * tenants shipping to any country, so no single phone format can be
   * assumed correct.
   */
  @IsString()
  @MinLength(1)
  recipientName!: string;

  @IsString()
  @MinLength(1)
  recipientPhone!: string;

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
