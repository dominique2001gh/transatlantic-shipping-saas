import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Records a failed/incomplete delivery attempt for an item currently
 * OUT_FOR_DELIVERY, once the physical package is back at a destination
 * warehouse. Two outcomes, same `hasException` split
 * ProcessItemDto/DestinationReceiveItemDto already use elsewhere in this
 * module:
 *   - hasException false (default): retry-eligible — recipient
 *     unavailable, will re-attempt, wrong address to be corrected. Item
 *     returns to RECEIVED_DESTINATION_WAREHOUSE, immediately eligible for
 *     a fresh dispatch or a walk-in pickup.
 *   - hasException true: needs staff review — refused permanently,
 *     damaged, lost. Item goes to EXCEPTION, same dead-end-until-manually-
 *     resolved posture EXCEPTION already has everywhere else in this app.
 *
 * `failureReason` is always required, regardless of outcome — the
 * business always wants to know why an attempt failed, not just whether
 * it needs review.
 */
export class ReturnItemDto {
  /** The destination warehouse the package is physically back at. */
  @IsString()
  warehouseId!: string;

  @IsString()
  @MinLength(1)
  failureReason!: string;

  @IsOptional()
  @IsBoolean()
  hasException?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsBoolean()
  scanned!: boolean;

  @IsOptional()
  @IsString()
  scanIdentifier?: string;
}
