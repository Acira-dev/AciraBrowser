import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { refreshedStatus } from '../src/features/settings/defaultBrowserStatus';

// "Make default" opens Windows' Default apps; the person chooses Acira there and comes back. The row used to read the status once, when it opened, and went on
// asking them to choose Acira until Settings was closed and opened again (the first-run setup has a "Check again" button for this; Settings had none).
const notDefault = { supported: true, isDefault: false, statusKnown: true, note: 'Choose Acira in Windows Settings' };

test('after the person made Acira the default, the row says so on the next answer', () => {
  const requested = { ...notDefault, requested: true };
  const now = refreshedStatus(requested, { ...notDefault, isDefault: true, note: 'Acira is your default browser' });
  assert.equal(now?.isDefault, true);
  assert.equal(now?.requested, undefined, 'a request that is over is not kept');
});

test('while it is still not the default, "requested" is kept (a plain status answer never carries it)', () => {
  const requested = { ...notDefault, requested: true };
  assert.deepEqual(refreshedStatus(requested, notDefault), { ...notDefault, requested: true });
  assert.deepEqual(refreshedStatus(undefined, notDefault), notDefault, 'nothing was requested: the answer as it is');
  assert.deepEqual(refreshedStatus(notDefault, { ...notDefault, note: 'x' }), { ...notDefault, note: 'x' });
});

test('an answer that did not arrive leaves the row as it was', () => {
  assert.equal(refreshedStatus(notDefault, undefined), notDefault);
  assert.equal(refreshedStatus(undefined, undefined), undefined);
});

test('the row asks again when the window gets focus, and stops when it goes away', () => {
  const source = fs.readFileSync(new URL('../src/features/settings/DefaultBrowserRow.tsx', import.meta.url), 'utf8');
  assert.match(source, /window\.addEventListener\('focus', ask\)/);
  assert.match(source, /window\.removeEventListener\('focus', ask\)/);
  assert.match(source, /refreshedStatus\(previous, result\.defaults \|\| result\.defaultResult\)/);
});
