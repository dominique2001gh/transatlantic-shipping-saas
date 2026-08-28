import { IsOptional, IsString } from 'class-validator';

export class UnloadItemDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
