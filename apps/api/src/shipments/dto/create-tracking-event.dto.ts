import { ShipmentItemStatus, ShipmentStatus, TrackingEventType } from '@transatlantic/shared';
import { IsDateString, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateTrackingEventDto {
  @IsEnum(TrackingEventType)
  eventType!: TrackingEventType;

  /** Set to log an item-level event; omitted for a shipment-level event. */
  @IsOptional()
  @IsString()
  shipmentItemId?: string;

  /** If set, also advances the shipment's denormalized Shipment.status. */
  @IsOptional()
  @IsEnum(ShipmentStatus)
  status?: ShipmentStatus;

  /** If set (requires shipmentItemId), also advances that item's ShipmentItem.status. */
  @IsOptional()
  @IsEnum(ShipmentItemStatus)
  itemStatus?: ShipmentItemStatus;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Defaults to now() if omitted. */
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  /** Flexible structured detail for this event (e.g. measured dimensions, exception detail). */
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
