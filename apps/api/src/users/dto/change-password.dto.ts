import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PATCH /users/me/password. `currentPassword` is verified server-side
 * (bcrypt.compare against the caller's own User.passwordHash) before
 * `newPassword` is accepted — see AuthService.changePassword.
 * `newPassword` is capped at 72 bytes because bcrypt silently truncates
 * anything longer; that isn't a new policy, just making explicit what the
 * existing hashing already does (see AuthService.hashPassword).
 */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
