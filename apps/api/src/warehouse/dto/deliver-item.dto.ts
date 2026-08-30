import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Confirms a successful delivery for an item currently OUT_FOR_DELIVERY.
 * `warehouseId` here is not a physical-custody check (the item isn't at
 * any warehouse while OUT_FOR_DELIVERY — see WarehouseService.dispatchItem)
 * — it records which warehouse's delivery operation this confirmation
 * belongs to, same as the currently-selected warehouse context every
 * other warehouse-mode screen already uses.
 *
 * Driver/courier fields are optional here (unlike DispatchItemDto, where
 * at least one is required) because the frontend is expected to carry
 * forward whatever was captured at dispatch — see
 * WarehouseService.deliverItem's most-recent-DISPATCH-record lookup —
 * but staff can override them if a different person actually completed
 * the handoff.
 */
export class DeliverItemDto {
  @IsString()
  warehouseId!: string;

  @IsString()
  @MinLength(1)
  recipientName!: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  recipientIdReference?: string;

  @IsOptional()
  @IsString()
  driverUserId?: string;

  @IsOptional()
  @IsString()
  courierName?: string;

  @IsOptional()
  @IsString()
  courierPhone?: string;

  @IsOptional()
  @IsString()
  courierReference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsBoolean()
  scanned!: boolean;

  @IsOptional()
  @IsString()
  scanIdentifier?: string;
}
