import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Min, MinLength } from 'class-validator';

/** One line item within a CreateInvoiceDto — freeform description + quantity/unitPrice. No rate/pricing engine backs this in Stage 3A; staff enter charges manually. */
export class InvoiceItemInputDto {
  @IsString()
  @MinLength(1)
  description!: string;

  /** Defaults to 1 in InvoicesService if omitted — see ShipmentItemInputDto for the same convention. */
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsNumber()
  @IsPositive()
  unitPrice!: number;
}
