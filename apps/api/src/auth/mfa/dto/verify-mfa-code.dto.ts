import { IsString, Matches } from 'class-validator';

/** A 6-digit TOTP code, as shown by any RFC 6238-compatible authenticator app. */
export class VerifyMfaCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits' })
  code!: string;
}
