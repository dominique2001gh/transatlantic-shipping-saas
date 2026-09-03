import { IsEnum } from 'class-validator';
import { WebsiteLeadStatus } from '@prisma/client';

export class UpdateLeadStatusDto {
  @IsEnum(WebsiteLeadStatus)
  status!: WebsiteLeadStatus;
}
