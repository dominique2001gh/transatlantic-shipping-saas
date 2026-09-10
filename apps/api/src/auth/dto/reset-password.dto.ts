import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /auth/reset-password. `token` is the raw, unhashed value from the
 * emailed link — AuthService.resetPassword hashes it before ever looking
 * it up (see AccountToken's own doc comment on why the raw value is never
 * stored). `password`/`confirmPassword` match ChangePasswordDto's
 * newPassword rule: 8-72 bytes, 72 being where bcrypt silently truncates.
 */
export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  confirmPassword!: string;
}
