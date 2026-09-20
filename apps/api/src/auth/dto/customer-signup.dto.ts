import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Customer Self-Service Pre-Registration, Stage 2: the smallest safe
 * first-time-customer signup path — see AuthService.customerSignup's own
 * doc comment for the tenant-resolution/account-linking rules. Deliberately
 * has no `role`/`tenantId`/`customerId` field: the global ValidationPipe's
 * `whitelist`/`forbidNonWhitelisted` config (see main.ts) rejects any
 * request body field not declared here outright, so there is no way for a
 * client to request a privileged role or pick its own tenant even if it
 * tried — the service never reads anything but these six fields. Same
 * 8-72 byte password rule as AcceptInviteDto/ResetPasswordDto (72 is where
 * bcrypt truncates).
 */
export class CustomerSignupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  confirmPassword!: string;
}
