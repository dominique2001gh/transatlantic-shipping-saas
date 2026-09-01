import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { InvoiceItemInputDto } from './invoice-item-input.dto';

/**
 * Stage 3A: manual invoice creation only — no auto-generation from
 * shipments, no rate/pricing engine. `customerId`/`shipmentId` are both
 * required (V1: one invoice belongs to exactly one customer and one
 * shipment) and are validated server-side in InvoicesService against the
 * caller's own tenant — never trusted as-is.
 */
export class CreateInvoiceDto {
  @IsString()
  customerId!: string;

  @IsString()
  shipmentId!: string;

  @IsString()
  @MinLength(1)
  currency!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /** A flat tax amount, not a rate/percentage — no tax-calculation engine in Stage 3A. Defaults to 0. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInputDto)
  items!: InvoiceItemInputDto[];
}
