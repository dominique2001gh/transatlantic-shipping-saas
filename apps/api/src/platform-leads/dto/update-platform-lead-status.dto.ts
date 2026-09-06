import { PlatformLeadStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdatePlatformLeadStatusDto {
  @IsEnum(PlatformLeadStatus)
  status!: PlatformLeadStatus;
}
