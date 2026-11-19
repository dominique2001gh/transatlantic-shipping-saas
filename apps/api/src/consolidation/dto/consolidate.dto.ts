import { DimensionUnit, ShipmentItemType, ShipmentMode, WeightUnit } from '@transatlantic/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** One receiving record's contribution to one final box — see ConsolidationAllocation's own doc comment in schema.prisma. */
export class ConsolidationAllocationInputDto {
  @IsString()
  receivingRecordId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

/**
 * One final shipping box — becomes exactly one ShipmentItem. Unlike
 * ShipmentItemInputDto (used by New Shipment/addItem, where a fresh item
 * starts REGISTERED, not yet physically received), a consolidated box's
 * contents are by construction already physically at the warehouse (they
 * came from one or more already-received ReceivingRecords) — see
 * ConsolidationService.consolidate for why it creates each box already in
 * the RECEIVED_ORIGIN_WAREHOUSE state, mirroring
 * ShipmentsService.createQuickReceive's identical reasoning rather than
 * the plain New-Shipment item-creation path.
 */
export class ConsolidationBoxDto {
  @IsEnum(ShipmentItemType)
  itemType!: ShipmentItemType;

  @IsOptional()
  @IsString()
  description?: string;

  /** How many identical physical boxes this one row represents — almost always 1. Defaults to 1, matching ShipmentItemInputDto's identical convention. */
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

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
  weight?: number;

  @IsOptional()
  @IsEnum(WeightUnit)
  weightUnit?: WeightUnit;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  declaredValue?: number;

  /** Which received deliveries (and how much of each) are packed into this box — must have at least one. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConsolidationAllocationInputDto)
  allocations!: ConsolidationAllocationInputDto[];
}

/**
 * Package Consolidation Phase 2: combines one or more of a customer's
 * AWAITING_CONSOLIDATION/PARTIALLY_CONSOLIDATED ReceivingRecords into one
 * or more final shipping boxes, producing exactly one new Shipment whose
 * items are those boxes. Reuses the exact same shipment-level fields
 * QuickReceiveDto already requires (recipient*, destination*,
 * originWarehouseId) — same required/optional shape, same rationale (see
 * QuickReceiveDto's own doc comment: origin geography is derived from
 * `originWarehouseId`, never client-supplied free text).
 */
export class ConsolidateDto {
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

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ConsolidationBoxDto)
  boxes!: ConsolidationBoxDto[];
}
