import { SaasPlanType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSaasPlanDto {
  @IsEnum(SaasPlanType)
  key!: SaasPlanType;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
