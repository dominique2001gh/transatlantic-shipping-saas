import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@transatlantic/shared';

/**
 * Defense-in-depth check used *in addition to* scoping every Prisma query
 * by tenantId. After loading a record, call this before returning it (or
 * acting on it) to guarantee a cross-tenant leak can never reach the
 * response even if a query was accidentally left unscoped.
 *
 * PLATFORM_ADMIN is exempt because it legitimately operates across
 * tenants (tenant management endpoints only).
 */
export function assertTenantAccess(
  requesterRole: UserRole,
  requesterTenantId: string | null,
  resourceTenantId: string,
): void {
  if (requesterRole === UserRole.PLATFORM_ADMIN) {
    return;
  }
  if (requesterTenantId !== resourceTenantId) {
    // 404, not 403: never confirm to a caller that a resource belonging
    // to another tenant exists.
    throw new NotFoundException('Resource not found');
  }
}

/** Throws if a staff/customer user somehow has no tenantId. Should never fire. */
export function requireTenantId(tenantId: string | null): string {
  if (!tenantId) {
    throw new ForbiddenException('No tenant context for this account');
  }
  return tenantId;
}

/**
 * Stage 2C: throws if a CUSTOMER-role user somehow has no linked
 * Customer.id. Should never fire given the schema (a CUSTOMER account is
 * only ever created with a Customer.userId link — see
 * apps/api/prisma/seed.ts), but every customer-portal endpoint calls this
 * before scoping a query, the same way every staff endpoint calls
 * requireTenantId — fail closed rather than silently querying with an
 * undefined customerId.
 */
export function requireCustomerId(customerId: string | null | undefined): string {
  if (!customerId) {
    throw new ForbiddenException('No customer context for this account');
  }
  return customerId;
}
