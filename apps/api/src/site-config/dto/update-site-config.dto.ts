import { IsArray, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateSiteConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tagline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  aboutContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  heroHeadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  heroSubheadline?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceTypes?: string[];

  @IsOptional()
  @IsUrl({ require_protocol: true })
  facebookUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  linkedinUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  instagramUrl?: string;
}
