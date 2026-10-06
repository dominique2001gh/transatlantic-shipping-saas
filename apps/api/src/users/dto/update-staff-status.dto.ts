import { IsBoolean } from 'class-validator';

/** PATCH /users/:id/status — gated by the `staff.manage` permission (OWNER always passes). Deactivating a user's last remaining active OWNER, or any OWNER target at all for a non-owner caller, is rejected by UsersService, not this DTO. */
export class UpdateStaffStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
