import { SaasPlanType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class StartSignupDto {
  @IsEnum(SaasPlanType)
  planKey!: SaasPlanType;
}
