import { ContainerType } from '@transatlantic/shared';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * `containerNumber` is staff-entered, not generated — real ISO container
 * numbers are assigned by the shipping line/leasing company, not by the
 * freight forwarder, so there is nothing to auto-generate here (unlike
 * trackingNumber/customerNumber). Tenant-scoped uniqueness is enforced by
 * the DB (`@@unique([tenantId, containerNumber])`).
 */
export class CreateContainerDto {
  @IsString()
  @MinLength(1)
  containerNumber!: string;

  @IsEnum(ContainerType)
  containerType!: ContainerType;

  /** The warehouse this container will be loaded at. Can be set later via update, but loading requires it. */
  @IsOptional()
  @IsString()
  warehouseId?: string;

  /** Optional intended route — used only for a soft destination-compatibility check when loading items. */
  @IsOptional()
  @IsString()
  routeId?: string;

  @IsOptional()
  @IsString()
  originPort?: string;

  @IsOptional()
  @IsString()
  destinationPort?: string;
}
