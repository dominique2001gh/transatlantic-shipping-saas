import { Injectable } from '@nestjs/common';
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
}
