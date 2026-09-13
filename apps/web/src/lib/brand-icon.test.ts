import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveBrandIconVariant } from './brand-icon';

/**
 * Proves the Titanic branding-leak fix: every hostname that isn't a Trans
 * Atlantic hostname — including ananselogix.com, where any newly
 * provisioned tenant's dashboard lives — resolves to the AnanseLogix
 * icon, never Trans Atlantic's, and Trans Atlantic's own hostnames are
 * completely unaffected.
 */

test('Trans Atlantic hostnames resolve to the trans-atlantic icon variant', () => {
  for (const host of ['talogisticssolutions.com', 'www.talogisticssolutions.com', 'app.talogisticssolutions.com']) {
    assert.equal(resolveBrandIconVariant(host), 'trans-atlantic', `expected ${host} to keep the Trans Atlantic icon`);
  }
});

test('ananselogix.com resolves to the ananselogix icon variant, never Trans Atlantic\'s', () => {
  assert.equal(resolveBrandIconVariant('ananselogix.com'), 'ananselogix');
});

test('a newly provisioned tenant\'s dashboard host is never hardcoded — any non-Trans-Atlantic host defaults to ananselogix', () => {
  for (const host of ['ananselogix.com', 'localhost:3000', 'web-production-31f5d.up.railway.app', 'some-future-tenant-domain.example.com']) {
    assert.equal(resolveBrandIconVariant(host), 'ananselogix', `expected ${host} to default to the AnanseLogix icon`);
  }
});

test('a missing/empty host header defaults to the ananselogix icon, not Trans Atlantic\'s', () => {
  assert.equal(resolveBrandIconVariant(null), 'ananselogix');
  assert.equal(resolveBrandIconVariant(undefined), 'ananselogix');
  assert.equal(resolveBrandIconVariant(''), 'ananselogix');
});
