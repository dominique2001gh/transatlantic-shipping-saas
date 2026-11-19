import { ReceivingCarrier } from '@transatlantic/shared';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';

/**
 * Warehouse Receiving Phase 1: logs one incoming delivery independently of
 * any Shipment — see ReceivingRecord's own doc comment in schema.prisma.
 * Never creates a Shipment or a label; see ReceivingService.create.
 *
 * `carrierTrackingNumber` is optional ("if available" per spec) — a
 * walk-in drop-off with no carrier leg has none. When present, the
 * service checks for an existing non-cancelled record sharing the same
 * carrier + tracking number within this tenant; `allowDuplicate` +
 * `duplicateOverrideReason` are the explicit, audited override for a
 * legitimate split delivery, never a silent default.
 */
export class CreateReceivingRecordDto {
  @IsString()
  customerId!: string;

  @IsString()
  warehouseId!: string;

  @IsEnum(ReceivingCarrier)
  carrier!: ReceivingCarrier;

  /** Required only when carrier = OTHER. */
  @ValidateIf((dto: CreateReceivingRecordDto) => dto.carrier === ReceivingCarrier.OTHER)
  @IsString()
  @MinLength(1)
  carrierOther?: string;

  @IsOptional()
  @IsString()
  carrierTrackingNumber?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Explicit override for a legitimate duplicate carrier-tracking-number delivery (e.g. a genuine split shipment) — see this class's own doc comment above. */
  @IsOptional()
  allowDuplicate?: boolean;

  @ValidateIf((dto: CreateReceivingRecordDto) => dto.allowDuplicate === true)
  @IsString()
  @MinLength(1)
  duplicateOverrideReason?: string;
}
