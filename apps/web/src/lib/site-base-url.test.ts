import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANANSELOGIX_BASE_URL, resolveSiteBaseUrl } from './site-base-url';
import { platformConfig } from './platform-config';

/**
 * AnanseLogix production site URL / canonical metadata (Step 3). Proves:
 *   - ANANSELOGIX_BASE_URL defaults to https://<platformConfig.domain>
 *     (single source of truth, no second hardcoded literal) when no env
 *     override is set.
 *   - resolveSiteBaseUrl returns that same AnanseLogix URL only for
 *     ananselogix.com/www.ananselogix.com.
 *   - Every Trans Atlantic hostname, and every other host (local dev, the
 *     raw Railway domain), keeps resolving to Trans Atlantic's own base
 *     URL, completely unaffected — proving the two brands' canonical URLs
 *     can never cross-contaminate through a shared variable.
 */

test('ANANSELOGIX_BASE_URL defaults to https://<platformConfig.domain>, not a second hardcoded literal', () => {
  assert.equal(ANANSELOGIX_BASE_URL, `https://${platformConfig.domain}`);
});

test('resolveSiteBaseUrl returns the AnanseLogix base URL for ananselogix.com and www.ananselogix.com', () => {
  assert.equal(resolveSiteBaseUrl('ananselogix.com'), ANANSELOGIX_BASE_URL);
  assert.equal(resolveSiteBaseUrl('www.ananselogix.com'), ANANSELOGIX_BASE_URL);
});

test('resolveSiteBaseUrl returns the Trans Atlantic base URL for every Trans Atlantic hostname', () => {
  for (const host of ['talogisticssolutions.com', 'www.talogisticssolutions.com', 'app.talogisticssolutions.com', 'api.talogisticssolutions.com']) {
    assert.equal(resolveSiteBaseUrl(host), 'https://talogisticssolutions.com', `expected ${host} to resolve to Trans Atlantic's own base URL`);
  }
});

test('resolveSiteBaseUrl falls back to the Trans Atlantic base URL for hosts with no special rule (local dev, raw Railway domain)', () => {
  assert.equal(resolveSiteBaseUrl('localhost:3000'), 'https://talogisticssolutions.com');
  assert.equal(resolveSiteBaseUrl('web-production-31f5d.up.railway.app'), 'https://talogisticssolutions.com');
  assert.equal(resolveSiteBaseUrl(null), 'https://talogisticssolutions.com');
  assert.equal(resolveSiteBaseUrl(undefined), 'https://talogisticssolutions.com');
});
