import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@transatlantic/shared';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given roles. Combine with the global JwtAuthGuard + RolesGuard. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
