import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Records a Customer Pickup handoff for an item that has reached
 * RECEIVED_DESTINATION_WAREHOUSE. Deliberately close in shape to
 * DestinationReceiveItemDto: warehouse-scoped, scan-or-manual provenance,
 * optional notes. No `condition`/`hasException` here — that judgment
 * already happened at destination-receive; pickup only records who took
 * the (already-verified) item and confirms it left the building.
 *
 * No signature/photo fields yet — see PickupDeliveryRecord's schema
 * comment. Adding them later is additive to this DTO too, not a redesign.
 */
export class PickupItemDto {
  /** The destination warehouse this pickup is happening at. */
  @IsString()
  warehouseId!: string;

  @IsString()
  @MinLength(1)
  recipientName!: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;

  /** Any ID shown/reference noted to verify the recipient — free text, not a controlled vocabulary. */
  @IsOptional()
  @IsString()
  recipientIdReference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Same provenance pattern as ReceiveItemDto/DestinationReceiveItemDto: server maps this to the real TrackingEventSource. */
  @IsBoolean()
  scanned!: boolean;

  @IsOptional()
  @IsString()
  scanIdentifier?: string;
}
