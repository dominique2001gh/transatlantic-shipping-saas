import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@transatlantic/shared';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * RBAC permissions (2026-10): restricts a route to callers who either are
 * OWNER (always, unconditionally — see PermissionsGuard) or whose
 * `AuthenticatedUser.permissions` includes this exact key. Layered on
 * top of, never instead of, the existing `@Roles(...)` gate — a route
 * must still pass RolesGuard first; this only narrows access further
 * within whichever role tier that already allows.
 *
 * Mirrors `@RequireEntitlement(...)` exactly (same SetMetadata + guard
 * shape) — see that decorator for the established pattern this follows.
 */
export const RequirePermission = (permission: PermissionKey) => SetMetadata(REQUIRE_PERMISSION_KEY, permission);
