import { UserRole } from '@prisma/client';
import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';

/**
 * Staff Invitations stage: canonical invite-staff request shape, used by
 * both the permanent staff-management page (POST /users/invite) and the
 * onboarding wizard's own Staff step (POST /onboarding/staff/invite) —
 * one DTO, one validation rule set, for the one underlying capability.
 */
export class InviteStaffDto {
  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}
