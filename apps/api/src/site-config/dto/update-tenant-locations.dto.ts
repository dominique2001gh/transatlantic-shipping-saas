import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class TenantLocationInputDto {
  @IsString()
  label!: string;

  @IsString()
  city!: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsString()
  country!: string;
}

/** Replace-all semantics — see SiteConfigService.replaceLocations's own doc comment for why. */
export class UpdateTenantLocationsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TenantLocationInputDto)
  locations!: TenantLocationInputDto[];
}
