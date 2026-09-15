import { IsBoolean } from 'class-validator';

/** PATCH /users/:id/status — OWNER only (STAFF_ADMIN_ROLES). Deactivating a user's last remaining active OWNER is rejected by UsersService, not this DTO. */
export class UpdateStaffStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
