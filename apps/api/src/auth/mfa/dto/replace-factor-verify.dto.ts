import { IsString, Matches, MinLength } from 'class-validator';

/** POST /users/me/mfa/replace/verify — confirms the caller can actually generate codes from the NEW factor before it ever becomes the active one. */
export class ReplaceFactorVerifyDto {
  @IsString()
  @MinLength(1)
  replaceToken!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits' })
  code!: string;
}
