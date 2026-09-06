import { ArrayNotEmpty, IsArray, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class SignupCompanyDto {
  @IsString()
  @MinLength(2)
  legalName!: string;

  @IsOptional()
  @IsString()
  tradingName?: string;

  @IsOptional()
  @IsString()
  businessPhone?: string;

  @IsOptional()
  @IsString()
  businessEmail?: string;

  @IsOptional()
  @IsUrl({ require_protocol: false })
  existingWebsite?: string;

  @IsString()
  country!: string;

  @IsOptional()
  @IsString()
  stateRegion?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsString()
  timezone!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  primaryShippingMarkets!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  serviceTypes!: string[];
}
