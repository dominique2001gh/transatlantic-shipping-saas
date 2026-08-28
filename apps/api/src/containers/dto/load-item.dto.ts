import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** Same scan-provenance shape as ReceiveItemDto/ProcessItemDto — server, not the client, maps this to TrackingEventSource. */
export class LoadItemDto {
  @IsBoolean()
  scanned!: boolean;

  @IsOptional()
  @IsString()
  scanIdentifier?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
