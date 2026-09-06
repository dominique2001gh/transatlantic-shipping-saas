import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupOwnerDto {
  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  /** Capped at 72 bytes — bcrypt silently truncates anything longer (same note as ChangePasswordDto). */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  confirmPassword!: string;
}
