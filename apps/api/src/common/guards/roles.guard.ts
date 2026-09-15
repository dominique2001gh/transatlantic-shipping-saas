import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

// Plain string literal, deliberately not the UserRole enum import — this
// guard compares against `requiredRoles: string[]` (raw @Roles() metadata)
// and `user.role` (a plain string at the JS level despite its TS enum
// type), so a literal avoids any cross-package enum-type friction between
// @prisma/client's generated UserRole and @transatlantic/shared's.
const PLATFORM_ADMIN_ROLE = 'PLATFORM_ADMIN';

/**
 * Enforces @Roles(...) metadata. Runs after JwtAuthGuard, so req.user is
 * always populated by the time this executes. Routes with no @Roles()
 * metadata are allowed for any authenticated user — mark those
 * deliberately with @AnyAuthenticatedRole() (see that decorator) rather
 * than leaving @Roles() off silently, so roles-guard-contract.e2e-spec.ts
 * can tell "intentionally open" apart from "someone forgot @Roles()."
 *
 * Defense-in-depth (RBAC V1 hardening): a route gated to PLATFORM_ADMIN
 * additionally requires `user.tenantId === null`. A real PLATFORM_ADMIN
 * account is only ever created with tenantId null (see schema.prisma's
 * own doc comment), so this changes nothing for legitimate platform
 * admins — but it closes off a token whose `role` claim was somehow set
 * to PLATFORM_ADMIN while still carrying a tenantId (e.g. a
 * staff-invite/role-change path that failed to validate the role, however
 * that might happen) from ever reaching a cross-tenant platform route.
 * Every `@Roles(UserRole.PLATFORM_ADMIN)` controller (tenants,
 * saas-plans, saas-analytics, platform-leads) is covered here centrally,
 * rather than each needing its own tenantId check.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user || !requiredRoles.includes(user.role)) {
      return false;
    }
    if (requiredRoles.includes(PLATFORM_ADMIN_ROLE) && (user.role as string) === PLATFORM_ADMIN_ROLE) {
      return user.tenantId === null;
    }
    return true;
  }
}
