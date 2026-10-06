import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSION_KEY_SET, UserRole } from '@transatlantic/shared';
import { writeTenantAuditLog } from '../common/tenant/tenant-audit.util';
import { PrismaService } from '../prisma/prisma.service';

const STAFF_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  permissions: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Reference implementation of the tenant-scoping pattern: tenantId is a
   * required parameter (sourced from the caller's JWT via @CurrentUser(),
   * never from a query param/body), and is always included in the
   * `where` clause. Every future module's data-access methods should
   * follow this same shape.
   */
  findStaffForTenant(tenantId: string) {
    return this.prisma.user.findMany({
      where: {
        tenantId,
        role: { not: UserRole.CUSTOMER },
      },
      orderBy: { createdAt: 'asc' },
      select: STAFF_SELECT,
    });
  }

  /**
   * Tenant-scoped lookup for a staff-administration target (role change /
   * activate-deactivate / permission change) — 404, not 403, on a
   * cross-tenant id (same "never confirm another tenant's resource
   * exists" posture as assertTenantAccess) and on a CUSTOMER-role
   * account, which this staff-only surface must never be able to touch.
   */
  private async findStaffMemberOrThrow(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user || user.role === UserRole.CUSTOMER) {
      throw new NotFoundException('Staff member not found');
    }
    return user;
  }

  /**
   * Counts a tenant's currently active OWNER users, optionally excluding
   * one user id (the target of an in-flight role change/deactivation) so
   * the caller can check "how many active owners would remain *after*
   * this change" in one query.
   */
  private countActiveOwners(tenantId: string, excludeUserId?: string) {
    return this.prisma.user.count({
      where: {
        tenantId,
        role: UserRole.OWNER,
        isActive: true,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
    });
  }

  /**
   * RBAC permissions (2026-10): the structural "non-owner can never touch
   * an OWNER" guarantee, applied before any of updateRole/setActiveStatus/
   * updatePermissions' own specific logic runs. Broader than the
   * pre-existing "would this leave zero active owners" check below —
   * that check only ever fired for an OWNER-initiated change; now that
   * these routes' role gate has been widened so a permission-holding
   * non-owner (e.g. an ADMIN-preset MANAGER with staff.manage) can reach
   * them too, a non-owner must be rejected outright the moment either the
   * current target OR the requested new role is OWNER — regardless of
   * remaining-owner count, and regardless of what permissions they hold.
   * Staff-management permissions can delegate *staff* administration;
   * they can never delegate *ownership* administration.
   */
  private assertCallerMayActOnOwnerBoundary(callerRole: string, targetRole: string, requestedRole?: string): void {
    if (callerRole === UserRole.OWNER) {
      return;
    }
    if (targetRole === UserRole.OWNER) {
      throw new ForbiddenException('Only an OWNER can modify, restrict, or deactivate another OWNER.');
    }
    if (requestedRole === UserRole.OWNER) {
      throw new ForbiddenException('Only an OWNER can promote a staff member to OWNER.');
    }
  }

  /**
   * RBAC permissions (2026-10): self-escalation prevention. A non-owner
   * granted staff-management permission can administer *other* staff, but
   * never their own account through this same surface — otherwise a
   * MANAGER with staff.manage could reactivate themselves after being
   * deactivated, or grant themselves a role/permission change nobody
   * actually approved. OWNER is exempt — a tenant with multiple owners has
   * always been allowed to have one freely act on their own row (see the
   * remaining-active-owner check below for the one real constraint on
   * that).
   */
  private assertCallerNotActingOnSelf(callerRole: string, callerUserId: string, targetUserId: string): void {
    if (callerRole === UserRole.OWNER) {
      return;
    }
    if (callerUserId === targetUserId) {
      throw new ForbiddenException('You cannot change your own role, status, or permissions.');
    }
  }

  /**
   * Changes a staff member's tier (OWNER/MANAGER/STAFF/FINANCE). Blocks
   * any change that would leave the tenant with zero active OWNERs — the
   * "OWNER must not accidentally be lockable out of their own tenant"
   * requirement — whether the target is the caller themselves or another
   * user, and regardless of whether the tenant currently has one OWNER or
   * several. A tenant with a second active OWNER can always freely
   * reassign/demote the first (OWNER caller only — see
   * assertCallerMayActOnOwnerBoundary/assertCallerNotActingOnSelf for the
   * additional restrictions applied to a non-owner caller).
   */
  async updateRole(tenantId: string, callerUserId: string, callerRole: UserRole, targetUserId: string, newRole: UserRole) {
    const target = await this.findStaffMemberOrThrow(tenantId, targetUserId);

    this.assertCallerNotActingOnSelf(callerRole, callerUserId, target.id);
    this.assertCallerMayActOnOwnerBoundary(callerRole, target.role, newRole);

    if (target.role === UserRole.OWNER && newRole !== UserRole.OWNER) {
      const remainingOwners = await this.countActiveOwners(tenantId, targetUserId);
      if (remainingOwners < 1) {
        throw new ForbiddenException(
          "Can't change this role — this tenant would be left with no active OWNER. Promote another user to OWNER first.",
        );
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: target.id }, data: { role: newRole }, select: STAFF_SELECT }),
      writeTenantAuditLog(this.prisma, {
        tenantId,
        actorUserId: callerUserId,
        targetUserId: target.id,
        action: 'ROLE_CHANGED',
        metadata: { before: target.role, after: newRole },
      }),
    ]);

    return updated;
  }

  /**
   * Activates/deactivates a staff member. Deactivating a tenant's last
   * active OWNER is rejected for the same reason updateRole rejects
   * demoting one — either way the tenant would end up with zero people
   * able to manage it. Reactivating is always allowed (it can only ever
   * increase the active-OWNER count, never decrease it).
   */
  async setActiveStatus(tenantId: string, callerUserId: string, callerRole: UserRole, targetUserId: string, isActive: boolean) {
    const target = await this.findStaffMemberOrThrow(tenantId, targetUserId);

    this.assertCallerNotActingOnSelf(callerRole, callerUserId, target.id);
    this.assertCallerMayActOnOwnerBoundary(callerRole, target.role);

    if (!isActive && target.role === UserRole.OWNER) {
      const remainingOwners = await this.countActiveOwners(tenantId, targetUserId);
      if (remainingOwners < 1) {
        throw new ForbiddenException(
          "Can't deactivate this user — this tenant would be left with no active OWNER. Promote another user to OWNER first.",
        );
      }
    }

    if (!isActive && !target.isActive) {
      throw new BadRequestException('This user is already inactive.');
    }
    if (isActive && target.isActive) {
      throw new BadRequestException('This user is already active.');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: target.id }, data: { isActive }, select: STAFF_SELECT }),
      writeTenantAuditLog(this.prisma, {
        tenantId,
        actorUserId: callerUserId,
        targetUserId: target.id,
        action: isActive ? 'STAFF_REACTIVATED' : 'STAFF_DEACTIVATED',
        metadata: { role: target.role },
      }),
    ]);

    return updated;
  }

  /**
   * RBAC permissions (2026-10): sets a staff member's fine-grained
   * permission array wholesale (the Staff page's checkbox form sends the
   * complete desired set, not a delta). An OWNER's own permissions are
   * never meaningfully restricted by this array (PermissionsGuard always
   * lets OWNER through) — rather than silently accept a no-op write
   * against an OWNER target, this rejects outright so the caller gets an
   * honest signal instead of a misleading "success."
   *
   * Non-owner callers (staff.permissions holders) face two additional
   * guards neither OWNER needs: they can never touch their own row (see
   * assertCallerNotActingOnSelf — otherwise a MANAGER with
   * staff.permissions could grant themselves anything), and they can
   * never grant a permission they don't themselves currently hold — "you
   * cannot delegate authority you don't have."
   */
  async updatePermissions(
    tenantId: string,
    callerUserId: string,
    callerRole: UserRole,
    callerPermissions: string[],
    targetUserId: string,
    newPermissions: string[],
  ) {
    const target = await this.findStaffMemberOrThrow(tenantId, targetUserId);

    if (target.role === UserRole.OWNER) {
      throw new ForbiddenException("An OWNER's permissions can't be restricted — OWNER already has unconditional access.");
    }

    this.assertCallerNotActingOnSelf(callerRole, callerUserId, target.id);

    if (callerRole !== UserRole.OWNER) {
      const notAuthorized = newPermissions.filter((p) => !callerPermissions.includes(p));
      if (notAuthorized.length > 0) {
        throw new ForbiddenException(`You cannot grant permissions you do not have yourself: ${notAuthorized.join(', ')}`);
      }
    }

    const invalid = newPermissions.filter((p) => !PERMISSION_KEY_SET.has(p));
    if (invalid.length > 0) {
      throw new BadRequestException(`Unknown permission key(s): ${invalid.join(', ')}`);
    }

    const before = target.permissions;

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: target.id }, data: { permissions: newPermissions }, select: STAFF_SELECT }),
      writeTenantAuditLog(this.prisma, {
        tenantId,
        actorUserId: callerUserId,
        targetUserId: target.id,
        action: 'PERMISSIONS_CHANGED',
        metadata: { before, after: newPermissions },
      }),
    ]);

    return updated;
  }
}
