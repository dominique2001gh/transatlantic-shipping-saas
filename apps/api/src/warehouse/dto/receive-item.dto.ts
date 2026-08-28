import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ReceiveItemDto {
  @IsString()
  warehouseId!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * True when this receive was triggered from the scan-input fast path,
   * false when it came from the manual search-and-select fallback. The
   * server — never the client — maps this to the actual
   * TrackingEventSource enum value, so a client can't claim an arbitrary
   * source.
   */
  @IsBoolean()
  scanned!: boolean;

  /** The raw code that was scanned/typed, for audit — only meaningful when scanned=true. */
  @IsOptional()
  @IsString()
  scanIdentifier?: string;
}
