import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Records handing an item off to a driver/courier for delivery. Same
 * shape as PickupItemDto with two differences: an optional delivery
 * address snapshot, and driver/courier identity instead of nothing.
 *
 * Driver/courier is deliberately two independent optional fields, not one
 * required field — WarehouseService.dispatchItem requires at least one of
 * driverUserId or courierName to be present (checked in the service, same
 * split every other business rule in this module uses), but neither is
 * itself a hard schema requirement: some tenants staff deliveries with a
 * logged-in employee (driverUserId), others with an independent driver or
 * third-party courier company that has no application account at all
 * (courierName/courierPhone/courierReference).
 */
export class DispatchItemDto {
  /** The destination warehouse this item is being dispatched from. */
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
  deliveryAddress?: string;

  /** An application User (e.g. an employee driver) performing this delivery — omit if using courierName instead. */
  @IsOptional()
  @IsString()
  driverUserId?: string;

  /** Free-text driver/courier name — for an independent driver or third-party courier company with no application account. */
  @IsOptional()
  @IsString()
  courierName?: string;

  @IsOptional()
  @IsString()
  courierPhone?: string;

  /** Free-text vehicle/company/tracking reference — e.g. plate number, waybill number. */
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
