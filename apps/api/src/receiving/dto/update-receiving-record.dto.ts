import { ReceivingCarrier } from '@transatlantic/shared';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';

/**
 * Warehouse Receiving Phase 1: corrects a receiving record's details —
 * never its tenant, customer, or internalReference. Every field here is
 * optional (a correction typically touches one or two fields); see
 * ReceivingService.update for the audit log this always writes
 * (`RECEIVING_RECORD_CORRECTED`, before/after).
 */
export class UpdateReceivingRecordDto {
  @IsOptional()
  @IsEnum(ReceivingCarrier)
  carrier?: ReceivingCarrier;

  @ValidateIf((dto: UpdateReceivingRecordDto) => dto.carrier === ReceivingCarrier.OTHER)
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
}
