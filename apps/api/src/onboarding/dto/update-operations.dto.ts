import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';

export class OnboardingWarehouseInputDto {
  @IsString()
  name!: string;

  @IsString()
  code!: string;

  @IsString()
  addressLine1!: string;

  @IsString()
  city!: string;

  @IsString()
  country!: string;

  @IsOptional()
  @IsBoolean()
  isOriginWarehouse?: boolean;

  @IsOptional()
  @IsBoolean()
  isDestinationWarehouse?: boolean;
}

export class UpdateOperationsDto {
  @IsOptional()
  @IsString()
  defaultOriginCountry?: string;

  @IsOptional()
  @IsString()
  defaultDestinationCountry?: string;

  /** New warehouses to create — this step never edits/removes existing ones, only adds. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingWarehouseInputDto)
  warehouses?: OnboardingWarehouseInputDto[];
}
