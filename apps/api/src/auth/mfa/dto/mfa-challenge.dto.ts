import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * POST /auth/mfa/challenge accepts either a 6-digit TOTP code (normal
 * case) or a recovery code (lost-device case) — never both required,
 * never both ignored. MfaService.challenge enforces "exactly one
 * present," not this DTO, since class-validator has no clean built-in
 * for "at least/exactly one of these two optional fields."
 */
export class MfaChallengeDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits' })
  code?: string;

  @IsOptional()
  @IsString()
  recoveryCode?: string;
}
