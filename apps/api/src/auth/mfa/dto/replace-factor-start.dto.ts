import { IsString, MinLength } from 'class-validator';

/** POST /users/me/mfa/replace — re-proves the caller's identity via their current password before issuing a new, unconfirmed TOTP secret. */
export class ReplaceFactorStartDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;
}
