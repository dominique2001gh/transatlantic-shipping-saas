import { ShipmentMode } from '@transatlantic/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ShipmentItemInputDto } from './shipment-item-input.dto';

export class CreateShipmentDto {
  @IsString()
  customerId!: string;

  @IsEnum(ShipmentMode)
  shipmentMode!: ShipmentMode;

  @IsString()
  @MinLength(1)
  originCountry!: string;

  @IsString()
  @MinLength(1)
  destinationCountry!: string;

  @IsOptional()
  @IsString()
  originLocation?: string;

  @IsOptional()
  @IsString()
  destinationLocation?: string;

  @IsOptional()
  @IsString()
  originWarehouseId?: string;

  @IsOptional()
  @IsString()
  destinationWarehouseId?: string;

  @IsOptional()
  @IsString()
  routeId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  declaredValue?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  /**
   * Consignee at destination — required, same as QuickReceiveDto (see its
   * own doc comment and Shipment.recipient* in schema.prisma). No phone
   * format/country regex — this platform serves tenants shipping to any
   * country.
   */
  @IsString()
  @MinLength(1)
  recipientName!: string;

  @IsString()
  @MinLength(1)
  recipientPhone!: string;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  recipientAddressLine1?: string;

  @IsOptional()
  @IsString()
  recipientAddressLine2?: string;

  @IsOptional()
  @IsString()
  recipientCity?: string;

  @IsOptional()
  @IsString()
  recipientState?: string;

  @IsOptional()
  @IsString()
  recipientCountry?: string;

  @IsOptional()
  @IsString()
  recipientPostalCode?: string;

  /** Optional items to create alongside the shipment in one request. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ShipmentItemInputDto)
  items?: ShipmentItemInputDto[];
}
