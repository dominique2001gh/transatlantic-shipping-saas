import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Regression test for the production false-failure bug (2026-10): the
 * Staff page's invite handler read `event.currentTarget.reset()` AFTER
 * `await inviteStaff(...)` had already resolved successfully. Per the
 * DOM spec (which React's SyntheticEvent mirrors), `currentTarget` is
 * only valid for the synchronous duration of an event's dispatch — it is
 * `null` by the time any code after an `await` runs. Calling `.reset()`
 * on that `null` threw a TypeError, which the surrounding try/catch
 * caught and treated as the whole operation having failed — even though
 * the invitation (and its email) had already fully succeeded. Two real
 * production invitations hit exactly this path.
 *
 * This can't be reproduced by rendering the real React component (this
 * repo has no React/DOM test renderer — only plain `node --test` unit
 * tests, see every sibling `*.test.ts` under src/lib). Instead, these
 * tests model the exact mechanism being relied on: a `currentTarget`
 * that is only valid synchronously and is nulled out once the handler
 * yields, exactly like a real SyntheticEvent/native DOM Event.
 */

interface FakeFormEvent {
  currentTarget: { reset: () => void } | null;
}

/** Mirrors a real dispatch: valid now, nulled out once this synchronous call returns. */
function fireFakeSubmit(onReset: () => void): FakeFormEvent {
  const event: FakeFormEvent = { currentTarget: { reset: onReset } };
  queueMicrotask(() => {
    event.currentTarget = null;
  });
  return event;
}

test('the buggy pattern: reading event.currentTarget after an await throws once it has been nulled out', async () => {
  let resetCalled = false;
  const event = fireFakeSubmit(() => {
    resetCalled = true;
  });

  await Promise.resolve(); // the same kind of async gap `await inviteStaff(...)` introduced

  assert.throws(() => event.currentTarget!.reset(), TypeError);
  assert.equal(resetCalled, false);
});

test('the fix: capturing the form element before the await lets reset() run safely after it', async () => {
  let resetCalled = false;
  const event = fireFakeSubmit(() => {
    resetCalled = true;
  });

  // This is the actual fix applied to handleInvite in page.tsx: capture
  // the reference synchronously, before anything async happens.
  const formElement = event.currentTarget!;

  await Promise.resolve();

  assert.doesNotThrow(() => formElement.reset());
  assert.equal(resetCalled, true);
});
