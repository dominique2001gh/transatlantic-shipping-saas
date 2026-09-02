import { Transform } from 'class-transformer';
import { DocumentType } from '@transatlantic/shared';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Stage 3G: fields alongside a multipart file upload
 * (`@UseInterceptors(FileInterceptor('file'))`). `shipmentId`/`customerId`
 * are never taken from here — the route itself
 * (POST /documents/shipments/:shipmentId or /documents/customers/:customerId)
 * is what determines which parent a document attaches to; DocumentsService
 * re-derives the other id server-side (a shipment's own customerId) so a
 * document can never be attributed to a shipment/customer pair that don't
 * actually belong together.
 *
 * `visibleToCustomer` arrives as the string "true"/"false" over multipart
 * form data, not a JSON boolean — @Transform coerces it before
 * @IsBoolean() runs. Defaults to false (fail-closed) if omitted entirely,
 * same default the schema itself carries.
 */
export class CreateDocumentDto {
  @IsEnum(DocumentType)
  type!: DocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  visibleToCustomer?: boolean;
}
