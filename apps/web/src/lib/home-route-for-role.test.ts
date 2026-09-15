import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserRole } from '@transatlantic/shared';
import { homeRouteForRole } from './auth';

/**
 * "Manage Billing" redirect-to-/login bug fix (2026-09): useRequireAuth
 * now sends an authenticated-but-wrong-role user to homeRouteForRole(role)
 * instead of /login (see useRequireAuth.ts's own doc comment for the full
 * story). This proves homeRouteForRole itself returns every tenant-staff
 * role (OWNER/MANAGER/STAFF/FINANCE) to /dashboard — never /login — which
 * is exactly what stops a MANAGER hitting the OWNER-only /onboarding
 * billing page from looking logged out.
 */

test('every tenant-staff role (OWNER/MANAGER/STAFF/FINANCE) goes to /dashboard', () => {
  for (const role of [UserRole.OWNER, UserRole.MANAGER, UserRole.STAFF, UserRole.FINANCE]) {
    assert.equal(homeRouteForRole(role), '/dashboard', `expected ${role} to route home to /dashboard`);
  }
});

test('PLATFORM_ADMIN goes to /platform', () => {
  assert.equal(homeRouteForRole(UserRole.PLATFORM_ADMIN), '/platform');
});

test('CUSTOMER goes to /portal', () => {
  assert.equal(homeRouteForRole(UserRole.CUSTOMER), '/portal');
});

test('never returns /login for any known role — that would defeat the whole point of this fix', () => {
  for (const role of Object.values(UserRole)) {
    assert.notEqual(homeRouteForRole(role as UserRole), '/login');
  }
});
