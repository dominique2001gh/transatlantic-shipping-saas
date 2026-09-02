import { DisruptionType } from '@transatlantic/shared';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Stage 3H: exactly one of containerId/manifestId must be set — enforced
 * in DisruptionsService (a cross-field rule like this is simpler to
 * express there, with a clear error message, than via a custom
 * class-validator decorator).
 */
export class CreateDisruptionDto {
  @IsOptional()
  @IsString()
  containerId?: string;

  @IsOptional()
  @IsString()
  manifestId?: string;

  @IsEnum(DisruptionType)
  type!: DisruptionType;

  /** Staff-written, customer-safe explanation — sent verbatim to every affected customer. Never include internal-only detail here. */
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  message!: string;
}
