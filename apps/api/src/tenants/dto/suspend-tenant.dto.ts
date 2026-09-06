import { IsOptional, IsString } from 'class-validator';

export class SuspendTenantDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
