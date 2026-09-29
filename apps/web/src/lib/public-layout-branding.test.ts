import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAnanseLogixHostname } from './ananselogix-hostname';

/**
 * Multi-tenant public-route branding fix (2026-09): apps/web/src/app/(public)/layout.tsx
 * (the shared shell for /login, /register, /dropoff, /dropoff/[tenantSlug],
 * /track, etc. — none of which are in middleware.ts's rewrite matcher, see
 * that file's own doc comment) uses exactly this one predicate to decide
 * between Trans Atlantic's own PublicHeader/PublicFooter and the generic
 * AnanseLogixHeader/AnanseLogixFooter. This suite pins that decision
 * directly against isAnanseLogixHostname (the same already-tested function
 * middleware.ts and sitemap.ts use), so a change to that function's
 * semantics can never silently change this layout's branding without a
 * test failing here too.
 *
 * Deliberately does not (cannot) assert per-tenant identity (Gold Coast vs
 * Titanic) — that distinction has no hostname to key off, since every
 * non-custom-domain tenant shares ananselogix.com. Per-tenant identity is
 * resolved separately, from real tenant data, by
 * fetchPublicSiteConfig(tenantSlug) inside dropoff/[tenantSlug]/page.tsx —
 * see apps/api/test/public-site-config-multi-tenant.e2e-spec.ts for that
 * coverage (Gold Coast's slug resolves Gold Coast's own name, Titanic's
 * resolves Titanic's, and neither ever resolves the other's or Trans
 * Atlantic's).
 */

test("ananselogix.com (shared by Gold Coast, Titanic, and every future non-custom-domain tenant) renders the generic AnanseLogix chrome, never Trans Atlantic's", () => {
  assert.equal(isAnanseLogixHostname('ananselogix.com'), true);
});

test('every Trans Atlantic hostname keeps its own PublicHeader/PublicFooter — completely unaffected by this fix', () => {
  for (const host of ['talogisticssolutions.com', 'www.talogisticssolutions.com', 'app.talogisticssolutions.com']) {
    assert.equal(isAnanseLogixHostname(host), false);
  }
});

test("a future tenant with its own customDomain never resolves ananselogix.com — unaffected by this check either way; true per-tenant branding on that domain is the same customDomain extension point tenant-web-app-url.util.ts already documents", () => {
  assert.equal(isAnanseLogixHostname('app.somefuturetenant.com'), false);
});

test('local dev and the raw Railway temp domain are unaffected — same Trans Atlantic default as before this fix, no new behavior introduced for these environments', () => {
  for (const host of ['localhost:3000', 'web-production-31f5d.up.railway.app', 'ananselogix-web-production.up.railway.app']) {
    assert.equal(isAnanseLogixHostname(host), false);
  }
});

test('a missing/empty host header defaults to Trans Atlantic chrome, never a crash or an incorrect AnanseLogix render', () => {
  assert.equal(isAnanseLogixHostname(null), false);
  assert.equal(isAnanseLogixHostname(undefined), false);
  assert.equal(isAnanseLogixHostname(''), false);
});
