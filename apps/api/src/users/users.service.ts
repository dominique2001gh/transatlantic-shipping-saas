import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSION_KEY_SET, UserRole } from '@transatlantic/shared';
import { AuthService } from '../auth/auth.service';
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

const REMOVED_STAFF_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  removedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

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
        // Owner-managed staff administration (2026-10): a removed staff
        // member is no longer part of the active team — it has its own
        // list (findRemovedStaffForTenant) with a Reinvite action instead.
        removedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: STAFF_SELECT,
    });
  }

  /**
   * Owner-managed staff administration (2026-10): the "Removed" section
   * of the Staff page — former staff whose email has been freed up for a
   * fresh invitation (see removeStaffMember), listed with just enough to
   * drive a "Reinvite" action (name, last role, email, when removed).
   * Never includes a CUSTOMER row, same as the active list above.
   */
  findRemovedStaffForTenant(tenantId: string) {
    return this.prisma.user.findMany({
      where: {
        tenantId,
        role: { not: UserRole.CUSTOMER },
        removedAt: { not: null },
      },
      orderBy: { removedAt: 'desc' },
      select: REMOVED_STAFF_SELECT,
    });
  }

  /**
   * Tenant-scoped lookup for a staff-administration target (role change /
   * activate-deactivate / permission change / removal / password reset) —
   * 404, not 403, on a cross-tenant id (same "never confirm another
   * tenant's resource exists" posture as assertTenantAccess), on a
   * CUSTOMER-role account, and on an already-removed row — all three
   * must look identically "not found" to this surface.
   */
  private async findStaffMemberOrThrow(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId, removedAt: null } });
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

  /**
   * Owner-managed staff administration (2026-10): removes a staff member
   * from the tenant WITHOUT deleting their User row — every historical
   * shipment/warehouse/audit record that FKs to this exact user id stays
   * attributed to them forever (see schema.prisma's own comment on why a
   * hard delete would silently erase that attribution via onDelete:
   * SetNull). Two things happen in one transaction: `isActive: false`
   * (same immediate session-revocation effect as setActiveStatus — see
   * JwtStrategy) and `removedAt: <now>`, which frees this row's email for
   * a brand-new invitation (see the partial unique index migration adds).
   * There is no "undo" — a removed staff member comes back only via a
   * fresh invite()/accept() cycle, creating a new row with a new id; this
   * is a deliberate, one-way action, not a second flavor of deactivation.
   *
   * Same guard shape as updateRole/setActiveStatus: non-owner caller can
   * never act on themselves or on an OWNER target, and removing a
   * tenant's last active OWNER is rejected for the same "must not leave
   * the tenant unmanageable" reason deactivating one is.
   */
  async removeStaffMember(tenantId: string, callerUserId: string, callerRole: UserRole, targetUserId: string) {
    const target = await this.findStaffMemberOrThrow(tenantId, targetUserId);

    this.assertCallerNotActingOnSelf(callerRole, callerUserId, target.id);
    this.assertCallerMayActOnOwnerBoundary(callerRole, target.role);

    if (target.role === UserRole.OWNER) {
      const remainingOwners = await this.countActiveOwners(tenantId, targetUserId);
      if (remainingOwners < 1) {
        throw new ForbiddenException(
          "Can't remove this user — this tenant would be left with no active OWNER. Promote another user to OWNER first.",
        );
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: target.id },
        data: { isActive: false, removedAt: new Date() },
        select: REMOVED_STAFF_SELECT,
      }),
      writeTenantAuditLog(this.prisma, {
        tenantId,
        actorUserId: callerUserId,
        targetUserId: target.id,
        action: 'STAFF_REMOVED',
        metadata: { role: target.role, email: target.email },
      }),
    ]);

    return updated;
  }

  /**
   * Owner-managed staff administration (2026-10): sends a password-reset
   * email to one specific staff member, scoped by exact id/tenant — the
   * OWNER never sees or sets the new password (AuthService.resetPassword
   * is the only place a password is ever written, same as the self-
   * service forgot-password flow). Same guard shape as the other actions
   * here (self/owner-boundary); additionally refuses a deactivated
   * target, since AuthService.requestPasswordReset's own self-service
   * twin already treats "inactive" as "no token issued" — sending one
   * here anyway would let a reset silently reactivate an account's
   * ability to sign back in ahead of a deliberate reactivation decision.
   */
  async triggerPasswordReset(tenantId: string, callerUserId: string, callerRole: UserRole, targetUserId: string) {
    const target = await this.findStaffMemberOrThrow(tenantId, targetUserId);

    this.assertCallerNotActingOnSelf(callerRole, callerUserId, target.id);
    this.assertCallerMayActOnOwnerBoundary(callerRole, target.role);

    if (!target.isActive) {
      throw new BadRequestException("Can't send a password reset to a deactivated account — reactivate it first.");
    }

    await this.authService.triggerPasswordResetForUserId(target.id);

    await writeTenantAuditLog(this.prisma, {
      tenantId,
      actorUserId: callerUserId,
      targetUserId: target.id,
      action: 'STAFF_PASSWORD_RESET_TRIGGERED',
      metadata: {},
    });

    return { success: true as const };
  }
}
