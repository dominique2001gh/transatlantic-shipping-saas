import { UserRole } from '@prisma/client';
import { IsEmail, IsEnum } from 'class-validator';

export class InviteStaffDto {
  @IsEmail()
  email!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}
