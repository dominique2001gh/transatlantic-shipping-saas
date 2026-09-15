import { UserRole } from '@prisma/client';
import { STAFF_ROLES } from '@transatlantic/shared';
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

/**
 * Staff Invitations stage: canonical invite-staff request shape, used by
 * both the permanent staff-management page (POST /users/invite) and the
 * onboarding wizard's own Staff step (POST /onboarding/staff/invite) —
 * one DTO, one validation rule set, for the one underlying capability.
 *
 * RBAC V1 hardening: `role` is validated against STAFF_ROLES (the 4
 * tenant-staff tiers: OWNER/MANAGER/STAFF/FINANCE) — never the full Prisma
 * UserRole enum, which also includes PLATFORM_ADMIN and CUSTOMER. Both of
 * those must never be reachable through a staff invite, regardless of who
 * is calling: PLATFORM_ADMIN would let an invite manufacture a
 * cross-tenant platform-admin account (see RolesGuard's own
 * tenantId-null hardening for the other half of this defense), and
 * CUSTOMER is a portal end-user, never invited through this staff-only
 * flow. StaffInvitationsService re-checks this same allow-list
 * server-side before writing to the database — this DTO check is real
 * enforcement, not just documentation, but defense-in-depth still applies.
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

  @IsIn(STAFF_ROLES)
  role!: UserRole;
}
