import { ShipmentItemCondition } from '@transatlantic/shared';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Records one destination-warehouse receiving pass over an item that has
 * ARRIVED_DESTINATION (via its manifest/container arriving — see
 * ManifestsService.arrive). Deliberately lighter than ProcessItemDto: no
 * weight/dimension remeasurement here, just "is this item physically
 * present and in the condition expected." Business rules (a damaged or
 * flagged item can never be marked received) are enforced in
 * WarehouseService.destinationReceiveItem, not here — same split
 * ProcessItemDto already uses.
 *
 * There is no `reinspection` escape hatch here (unlike ProcessItemDto):
 * a duplicate destination-receive scan is always an accidental double
 * scan, never a legitimate deliberate re-receive, so it stays a hard
 * reject — matching ReceiveItemDto's own simplicity at origin.
 */
export class DestinationReceiveItemDto {
  /** The destination warehouse this receiving is happening at. */
  @IsString()
  warehouseId!: string;

  @IsEnum(ShipmentItemCondition)
  condition!: ShipmentItemCondition;

  /** Damage/missing/discrepancy indicator — independent of `condition`. */
  @IsOptional()
  @IsBoolean()
  hasException?: boolean;

  /** Required by the service when hasException is true — also how a "missing" item is recorded (see service doc comment). */
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
}
