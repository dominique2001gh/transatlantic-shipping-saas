import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_SUSPENDED_KEY = 'allowWhenSuspended';

/**
 * AnanseLogix Phase 1: opts a route out of SubscriptionStatusGuard's
 * lockout for a SUSPENDED tenant — the explicit allowlist Section 9 of the
 * build brief requires ("the owner must retain enough access during
 * suspension to manage billing and restore the subscription"). Applied to
 * the onboarding module (billing summary + Stripe portal session) and
 * GET /tenants/me (so the frontend has enough identity/tenant info to
 * render a "your subscription is suspended" screen in the first place).
 * The same explicit-opt-in posture @Public()/@AnyAuthenticatedRole()
 * already establish in this codebase, rather than an implicit allowlist
 * that's easy to accidentally widen.
 */
export const AllowWhenSuspended = () => SetMetadata(ALLOW_WHEN_SUSPENDED_KEY, true);
