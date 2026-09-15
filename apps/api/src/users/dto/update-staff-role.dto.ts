import type { UserRole } from '@transatlantic/shared';
import { STAFF_ROLES } from '@transatlantic/shared';
import { IsIn } from 'class-validator';

/**
 * PATCH /users/:id/role — OWNER only (STAFF_ADMIN_ROLES). Validated
 * against STAFF_ROLES (OWNER/MANAGER/STAFF/FINANCE), never the full
 * UserRole enum — same reasoning as InviteStaffDto's own doc comment:
 * PLATFORM_ADMIN and CUSTOMER must never be reachable through a
 * tenant-staff-administration endpoint. UsersService additionally
 * enforces the "a tenant always keeps at least one active OWNER"
 * invariant — this DTO only validates that the requested role is a real,
 * assignable tenant-staff tier.
 */
export class UpdateStaffRoleDto {
  @IsIn(STAFF_ROLES)
  role!: UserRole;
}
