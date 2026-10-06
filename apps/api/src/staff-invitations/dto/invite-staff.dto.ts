import { UserRole } from '@prisma/client';
import { PERMISSION_KEYS, STAFF_ROLES } from '@transatlantic/shared';
import { ArrayUnique, IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

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

  /**
   * RBAC permissions (2026-10): optional fine-grained permissions to
   * apply to the User created when this invitation is accepted. Omitted
   * (or empty) means "no optional permissions" — a deliberate, legitimate
   * state for a new post-RBAC staff member, not a bug (see
   * User.permissions' own schema doc comment). StaffInvitationsService
   * additionally rejects a non-owner inviter granting a permission they
   * don't themselves hold, and rejects role: OWNER from any non-owner
   * inviter — this DTO only validates that every key is real.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions?: string[];
}
