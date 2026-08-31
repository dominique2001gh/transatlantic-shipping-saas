import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@transatlantic/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Enforces @Roles(...) metadata. Runs after JwtAuthGuard, so req.user is
 * always populated by the time this executes. Routes with no @Roles()
 * metadata are allowed for any authenticated user — mark those
 * deliberately with @AnyAuthenticatedRole() (see that decorator) rather
 * than leaving @Roles() off silently, so roles-guard-contract.e2e-spec.ts
 * can tell "intentionally open" apart from "someone forgot @Roles()."
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
    return !!user && requiredRoles.includes(user.role);
  }
}
