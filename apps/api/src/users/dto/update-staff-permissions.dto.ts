import { PERMISSION_KEYS } from '@transatlantic/shared';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';

/**
 * PATCH /users/:id/permissions — sets a staff member's complete
 * fine-grained permission set (replaces, not merges). Validated against
 * the closed PERMISSION_KEYS list — same defense-in-depth pattern as
 * InviteStaffDto's own doc comment: UsersService.updatePermissions
 * re-validates server-side regardless, but this DTO check still applies
 * first and produces a clean 400 for an unknown key rather than reaching
 * the service at all.
 */
export class UpdateStaffPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions!: string[];
}
