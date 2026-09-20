import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSafeNextPath } from './post-login';

/**
 * /dropoff entry point: resolveSafeNextPath is the one thing standing
 * between a browser-supplied `?next=` query param and an open redirect —
 * it must only ever return a value from its own fixed allow-list, never
 * echo back arbitrary input.
 */

test('returns the allow-listed path unchanged', () => {
  assert.equal(resolveSafeNextPath('/portal/pre-register'), '/portal/pre-register');
});

test('returns null for null/undefined/empty input', () => {
  assert.equal(resolveSafeNextPath(null), null);
  assert.equal(resolveSafeNextPath(undefined), null);
  assert.equal(resolveSafeNextPath(''), null);
});

test('rejects any path not on the allow-list', () => {
  assert.equal(resolveSafeNextPath('/portal'), null);
  assert.equal(resolveSafeNextPath('/dashboard'), null);
  assert.equal(resolveSafeNextPath('/portal/pre-register/extra'), null);
  assert.equal(resolveSafeNextPath('portal/pre-register'), null); // missing leading slash
});

test('never treats an absolute or protocol-relative URL as safe — the actual open-redirect case', () => {
  assert.equal(resolveSafeNextPath('https://evil.example/phish'), null);
  assert.equal(resolveSafeNextPath('//evil.example'), null);
  assert.equal(resolveSafeNextPath('http://evil.example/portal/pre-register'), null);
});
