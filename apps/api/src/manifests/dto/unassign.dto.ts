import { IsOptional, IsString } from 'class-validator';

/** Shared shape for unassigning either a container or a direct item from a manifest. */
export class UnassignDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
