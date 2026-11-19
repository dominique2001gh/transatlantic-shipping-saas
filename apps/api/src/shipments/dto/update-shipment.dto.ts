import { IsBoolean, IsEmail, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

/**
 * Shipment Editing Phase 4: descriptive/logistical/consignee field updates
 * only — deliberately excludes `status`. Shipment status only ever
 * changes via a tracking event (see CreateTrackingEventDto), never a raw
 * PATCH, so status history can never be silently overwritten.
 *
 * Which of these fields a given request may actually set is enforced by
 * ShipmentsService.resolveEditableFieldsForStatus, not by this DTO —
 * every field here is optional at the DTO layer because the valid set
 * varies by the shipment's current lifecycle status (see that method's
 * own doc comment for the full tier table).
 */
export class UpdateShipmentDto {
  @IsOptional()
  @IsString()
  originLocation?: string;

  @IsOptional()
  @IsString()
  destinationCountry?: string;

  @IsOptional()
  @IsString()
  destinationLocation?: string;

  @IsOptional()
  @IsString()
  originWarehouseId?: string;

  @IsOptional()
  @IsString()
  destinationWarehouseId?: string;

  @IsOptional()
  @IsString()
  routeId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  declaredValue?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;

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

  /** Required when the edit changes a label-visible field on a BOOKED shipment — see resolveEditableFieldsForStatus's own doc comment. */
  @IsOptional()
  @IsBoolean()
  confirmLabelRegeneration?: boolean;

  /** Required when editing a DELIVERED/COMPLETED shipment — see resolveEditableFieldsForStatus's own doc comment. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}
