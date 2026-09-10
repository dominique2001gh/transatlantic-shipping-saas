import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveHostnameRouting } from './hostname-routing';

/**
 * AnanseLogix hostname routing (Step 2). Proves three things:
 *   1. AnanseLogix hostname -> AnanseLogix site (rewritten to /ananselogix/*,
 *      URL unchanged), including the www -> apex canonicalization.
 *   2. Trans Atlantic hostnames keep their exact existing behavior
 *      (unaffected paths pass through untouched; /ananselogix/* still 404s;
 *      the staff-hostname root-> /dashboard rewrite still fires).
 *   3. Internal app/customer/staff routes (/dashboard, /portal, /login,
 *      /track) are unaffected on every hostname that isn't ananselogix.com.
 *
 * Pure-function tests (see hostname-routing.ts's own doc comment) — no
 * Next.js runtime, no dev server, no request/response mocking.
 */

// ---------------------------------------------------------------------------
// 1. AnanseLogix hostname -> AnanseLogix site
// ---------------------------------------------------------------------------

test('ananselogix.com root ("/") rewrites to /ananselogix, URL unchanged in the browser', () => {
  assert.deepEqual(resolveHostnameRouting('ananselogix.com', '/'), { type: 'rewrite', pathname: '/ananselogix' });
});

test('ananselogix.com public routes resolve at the root without exposing /ananselogix', () => {
  const cases: [string, string][] = [
    ['/features', '/ananselogix/features'],
    ['/how-it-works', '/ananselogix/how-it-works'],
    ['/pricing', '/ananselogix/pricing'],
    ['/solutions', '/ananselogix/solutions'],
    ['/demo', '/ananselogix/demo'],
    ['/login', '/ananselogix/login'],
    ['/signup', '/ananselogix/signup'],
    ['/signup/success', '/ananselogix/signup/success'],
  ];
  for (const [requestedPath, expectedRewrite] of cases) {
    assert.deepEqual(
      resolveHostnameRouting('ananselogix.com', requestedPath),
      { type: 'rewrite', pathname: expectedRewrite },
      `expected ${requestedPath} to rewrite to ${expectedRewrite}`,
    );
  }
});

test('ananselogix.com requests already under /ananselogix are left alone (no double-prefixing)', () => {
  assert.deepEqual(resolveHostnameRouting('ananselogix.com', '/ananselogix'), { type: 'next' });
  assert.deepEqual(resolveHostnameRouting('ananselogix.com', '/ananselogix/features'), { type: 'next' });
});

test('www.ananselogix.com redirects to the bare apex (canonical host), for any path', () => {
  assert.deepEqual(resolveHostnameRouting('www.ananselogix.com', '/'), { type: 'redirectToAnanseLogixApex' });
  assert.deepEqual(resolveHostnameRouting('www.ananselogix.com', '/pricing'), { type: 'redirectToAnanseLogixApex' });
});

test('a port suffix on the host header does not defeat AnanseLogix hostname matching (local/proxy edge case)', () => {
  assert.deepEqual(resolveHostnameRouting('ananselogix.com:443', '/'), { type: 'rewrite', pathname: '/ananselogix' });
});

// ---------------------------------------------------------------------------
// 2. Trans Atlantic hostnames keep their exact existing behavior
// ---------------------------------------------------------------------------

test('Trans Atlantic hostnames still 404 on /ananselogix/*, exactly as before', () => {
  for (const host of ['talogisticssolutions.com', 'www.talogisticssolutions.com', 'app.talogisticssolutions.com', 'api.talogisticssolutions.com']) {
    assert.deepEqual(resolveHostnameRouting(host, '/ananselogix'), { type: 'notFound' }, `expected ${host} to 404 on /ananselogix`);
    assert.deepEqual(resolveHostnameRouting(host, '/ananselogix/pricing'), { type: 'notFound' }, `expected ${host} to 404 on /ananselogix/pricing`);
  }
});

test('the staff hostname root still rewrites to /dashboard, unchanged', () => {
  assert.deepEqual(resolveHostnameRouting('app.talogisticssolutions.com', '/'), { type: 'rewrite', pathname: '/dashboard' });
});

test('the staff hostname is unaffected on every other path', () => {
  for (const path of ['/dashboard', '/platform', '/portal', '/login', '/track']) {
    assert.deepEqual(resolveHostnameRouting('app.talogisticssolutions.com', path), { type: 'next' });
  }
});

test('the bare Trans Atlantic apex and www are unaffected on the public site\'s own routes', () => {
  for (const host of ['talogisticssolutions.com', 'www.talogisticssolutions.com']) {
    for (const path of ['/', '/login', '/how-it-works', '/track', '/register']) {
      assert.deepEqual(resolveHostnameRouting(host, path), { type: 'next' }, `expected ${host}${path} to pass through untouched`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Internal app/customer/staff routes are unaffected on every non-
//    AnanseLogix hostname, including hosts with no special rule at all
//    (local dev, the raw Railway temp domain).
// ---------------------------------------------------------------------------

test('internal routes are unaffected on hosts with no special rule (local dev, raw Railway domain)', () => {
  for (const host of ['localhost:3000', 'web-production-31f5d.up.railway.app']) {
    for (const path of ['/dashboard', '/portal', '/login', '/track', '/']) {
      assert.deepEqual(resolveHostnameRouting(host, path), { type: 'next' }, `expected ${host}${path} to pass through untouched`);
    }
    // /ananselogix/* must still work by its literal path on these hosts —
    // neither the AnanseLogix rewrite nor the Trans Atlantic 404 applies.
    assert.deepEqual(resolveHostnameRouting(host, '/ananselogix'), { type: 'next' });
  }
});

test('a missing/empty host header never matches any hostname-specific rule', () => {
  assert.deepEqual(resolveHostnameRouting(null, '/'), { type: 'next' });
  assert.deepEqual(resolveHostnameRouting(undefined, '/pricing'), { type: 'next' });
  assert.deepEqual(resolveHostnameRouting('', '/dashboard'), { type: 'next' });
});
