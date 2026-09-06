import { PlatformLeadSource } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePlatformLeadDto {
  @IsString()
  @MinLength(1)
  companyName!: string;

  @IsString()
  @MinLength(1)
  contactName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  currentWorkflow?: string;

  @IsOptional()
  @IsString()
  monthlyShipmentVolume?: string;

  @IsOptional()
  @IsString()
  currentSoftware?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  servicesOffered!: string[];

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsEnum(PlatformLeadSource)
  source?: PlatformLeadSource;
}
