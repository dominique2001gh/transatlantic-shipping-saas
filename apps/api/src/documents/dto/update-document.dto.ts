import { Transform } from 'class-transformer';
import { DocumentType } from '@transatlantic/shared';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Stage 3G: PATCH /documents/:id. Deliberately cannot change the file
 * itself, `shipmentId`, or `customerId` — the underlying file is
 * append-only (re-upload as a new document instead, same convention
 * payments/tracking events already follow); only classification and
 * visibility are ever mutable after upload.
 */
export class UpdateDocumentDto {
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  visibleToCustomer?: boolean;
}
