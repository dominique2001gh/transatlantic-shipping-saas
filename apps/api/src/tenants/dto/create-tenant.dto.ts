import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, numbers and hyphens',
  })
  slug!: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsString()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsString()
  country!: string;

  @IsString()
  timezone!: string;

  @IsString()
  currency!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
