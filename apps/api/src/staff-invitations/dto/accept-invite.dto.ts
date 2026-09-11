import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /auth/accept-invite. `token` is the raw, unhashed value from the
 * emailed link — StaffInvitationsService.accept hashes it before ever
 * looking it up (see TenantInvitation's own doc comment on why the raw
 * value is never stored). No firstName/lastName/email/role here — those
 * were already fixed by the inviter and live on the TenantInvitation row;
 * the employee only ever sets their own password. Same 8-72 byte rule as
 * ChangePasswordDto/ResetPasswordDto (72 is where bcrypt truncates).
 */
export class AcceptInviteDto {
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
