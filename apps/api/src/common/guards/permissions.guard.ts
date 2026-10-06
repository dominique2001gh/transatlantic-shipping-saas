import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser, PermissionKey } from '@transatlantic/shared';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

/**
 * RBAC permissions (2026-10): enforces @RequirePermission(...) metadata.
 * Runs after JwtAuthGuard/RolesGuard (registered later in app.module.ts),
 * so req.user is always populated and the caller has already cleared the
 * coarse role gate — this guard only ever narrows further within a role
 * tier RolesGuard already allowed. Routes with no @RequirePermission()
 * metadata are unaffected — purely additive, never a replacement for the
 * existing role system.
 *
 * OWNER always passes, unconditionally, without consulting
 * `user.permissions` at all — OWNER is the one role this permission layer
 * can never restrict (see User.permissions' own schema doc comment and
 * the Phase A/B/C decisions behind it). Every other role — including
 * MANAGER — is checked exactly like any other staff tier; nothing here
 * special-cases MANAGER.
 *
 * `user.permissions` comes from JwtStrategy.validate's fresh per-request
 * DB read, so a permission grant/revocation takes effect on the very next
 * request — no caching, no re-login required.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<PermissionKey | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user) {
      return true;
    }

    if ((user.role as unknown as UserRole) === UserRole.OWNER) {
      return true;
    }

    if (!user.permissions?.includes(permission)) {
      throw new ForbiddenException(`You do not have permission to perform this action (${permission})`);
    }

    return true;
  }
}
