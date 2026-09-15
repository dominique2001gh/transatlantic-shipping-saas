import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@transatlantic/shared';
import { PrismaService } from '../prisma/prisma.service';

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
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Tenant-scoped lookup for a staff-administration target (role change /
   * activate-deactivate) — 404, not 403, on a cross-tenant id (same
   * "never confirm another tenant's resource exists" posture as
   * assertTenantAccess) and on a CUSTOMER-role account, which this
   * staff-only surface must never be able to touch.
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
   * Changes a staff member's tier (OWNER/MANAGER/STAFF/FINANCE). Blocks
   * any change that would leave the tenant with zero active OWNERs — the
   * "OWNER must not accidentally be lockable out of their own tenant"
   * requirement — whether the target is the caller themselves or another
   * user, and regardless of whether the tenant currently has one OWNER or
   * several. A tenant with a second active OWNER can always freely
   * reassign/demote the first.
   */
  async updateRole(tenantId: string, targetUserId: string, newRole: UserRole) {
    const target = await this.findStaffMemberOrThrow(tenantId, targetUserId);

    if (target.role === UserRole.OWNER && newRole !== UserRole.OWNER) {
      const remainingOwners = await this.countActiveOwners(tenantId, targetUserId);
      if (remainingOwners < 1) {
        throw new ForbiddenException(
          "Can't change this role — this tenant would be left with no active OWNER. Promote another user to OWNER first.",
        );
      }
    }

    return this.prisma.user.update({
      where: { id: target.id },
      data: { role: newRole },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Activates/deactivates a staff member. Deactivating a tenant's last
   * active OWNER is rejected for the same reason updateRole rejects
   * demoting one — either way the tenant would end up with zero people
   * able to manage it. Reactivating is always allowed (it can only ever
   * increase the active-OWNER count, never decrease it).
   */
  async setActiveStatus(tenantId: string, targetUserId: string, isActive: boolean) {
    const target = await this.findStaffMemberOrThrow(tenantId, targetUserId);

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

    return this.prisma.user.update({
      where: { id: target.id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }
}
