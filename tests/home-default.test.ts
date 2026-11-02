import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, restoreSnapshot } from '../src/runtime/core';

test('R4-26 Home is on for a fresh profile and for a saved profile that never had the new default; a later choice sticks', () => {
  assert.equal(createInitialState().settings.showHome, true);
  const saved = createInitialState();
  const old = JSON.parse(JSON.stringify({ ...saved, settings: { ...saved.settings, showHome: false, homeButtonDefault: undefined } }));
  const migrated = restoreSnapshot(old);
  assert.equal(migrated.settings.showHome, true, 'Home was off only because it was the old default');
  assert.equal(migrated.settings.homeButtonDefault, 2);
  // The person turns it off afterwards: it stays off across restarts.
  const chosen = restoreSnapshot(JSON.parse(JSON.stringify({ ...migrated, settings: { ...migrated.settings, showHome: false } })));
  assert.equal(chosen.settings.showHome, false);
});
