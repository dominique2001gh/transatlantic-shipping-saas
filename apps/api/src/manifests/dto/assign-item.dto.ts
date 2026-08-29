import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** Air-freight direct assignment — same scan-provenance shape as ReceiveItemDto/ProcessItemDto/LoadItemDto. */
export class AssignItemDto {
  @IsBoolean()
  scanned!: boolean;

  @IsOptional()
  @IsString()
  scanIdentifier?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
