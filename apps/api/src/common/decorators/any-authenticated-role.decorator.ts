import { SetMetadata } from '@nestjs/common';

export const ANY_AUTHENTICATED_ROLE_KEY = 'anyAuthenticatedRole';

/**
 * Explicitly marks a route as intentionally open to every authenticated
 * role — staff and CUSTOMER alike (e.g. "return my own profile," "return
 * my own tenant's public info"). RolesGuard already allows any
 * authenticated user through when a route has no @Roles() metadata at
 * all, so this decorator changes no runtime behavior — its only purpose
 * is to make that state a deliberate declaration instead of silence, so
 * "deliberately open to everyone" can never be mistaken for "someone
 * forgot @Roles()." See roles-guard-contract.e2e-spec.ts, which requires
 * every route to carry @Roles(...), @Public(), or this.
 */
export const AnyAuthenticatedRole = () => SetMetadata(ANY_AUTHENTICATED_ROLE_KEY, true);
