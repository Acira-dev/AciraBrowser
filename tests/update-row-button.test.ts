import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { UpdateStatus } from '../src/runtime/nativeNetwork';
import { describe, rowAction } from '../src/features/settings/updateRow';

// Settings > About > Check for updates looked wrong when pressed: the button turned into "Checking…" (a third narrower, so it jumped), kept that
// word through the whole download, and on a Mac a failed check put the updater's 200-character HttpError under the title, five lines that pushed
// the button down. The button now keeps its words while it waits and the line under the title stays one sentence.
const status = (patch: Partial<UpdateStatus>): UpdateStatus => ({ status: 'idle', version: '0.1.0-beta.8', available: null, progress: null, transferred: null, total: null, speed: null, notes: '', lastChecked: null, error: null, autoDownload: true, channel: 'beta', supported: true, reason: null, ...patch } as UpdateStatus);

test('the button keeps its words while it waits, so it never changes width under the pointer, and only a download turns it off', () => {
  assert.deepEqual(rowAction(status({ status: 'idle' })), { action: 'update.check', disabled: false });
  assert.deepEqual(rowAction(status({ status: 'checking' })), { action: 'update.check', disabled: false }, 'checking: the same button, as it is (no disabled flash for the one to three seconds a Mac check takes)');
  assert.deepEqual(rowAction(status({ status: 'downloading', available: '0.1.0-beta.9', progress: 42 })), { action: 'update.check', disabled: true }, 'a download the check started on its own: still the same button');
  assert.deepEqual(rowAction(status({ status: 'current' })), { action: 'update.check', disabled: false });
  assert.deepEqual(rowAction(status({ status: 'error', error: 'x' })), { action: 'update.check', disabled: false });
  assert.deepEqual(rowAction(status({ status: 'available', autoDownload: false })), { action: 'update.download', disabled: false });
  assert.deepEqual(rowAction(status({ status: 'downloading', autoDownload: false })), { action: 'update.download', disabled: true }, 'a download started with Download stays Download');
  assert.deepEqual(rowAction(status({ status: 'ready', available: '0.1.0-beta.9' })), { action: 'update.install', disabled: false });
  assert.deepEqual(rowAction(status({ status: 'unsupported', supported: false, reason: 'Updates are off.' })), { action: 'update.check', disabled: true });
  assert.deepEqual(rowAction(undefined), { action: 'update.check', disabled: true }, 'before the first answer');
  const source = readFileSync('src/features/settings/panels/updates.tsx', 'utf8');
  assert.doesNotMatch(source, /cleanup\.checking/, 'no "Checking…" label on the button');
});

test('a failed check is one sentence under the title; the updater\'s own words go in the note below the group', () => {
  const long = 'Cannot find channel "beta-mac.yml" update info: HttpError: 404 "method: GET url: https://github.com/example/releases/download/v0.1.0-beta.8/beta-mac.yml';
  assert.equal(describe(status({ status: 'error', error: long })), 'Could not check for updates.');
  assert.equal(describe(status({ status: 'checking' })), 'Checking for updates…');
  assert.equal(describe(status({ status: 'downloading', available: '0.1.0-beta.9', progress: 42 })), 'Downloading version 0.1.0-beta.9 · 42%');
  const source = readFileSync('src/features/settings/panels/updates.tsx', 'utf8');
  // (also while paused again after a Resume that could not connect: update-pause-ui.test.ts)
  assert.match(source, /\{\(status\?\.status === 'error' \|\| status\?\.status === 'paused'\) && status\.error && <SettingNote>\{t\('import\.technicalDetails'\)\}: \{status\.error\}<\/SettingNote>\}/);
});

test('the press says "Checking for updates…" at once, and a keyboard user keeps the button when the wait ends', () => {
  const source = readFileSync('src/features/settings/panels/updates.tsx', 'utf8');
  assert.match(source, /if \(type === 'update\.check'\) setStatus\(\(current\) => current && \{ \.\.\.current, status: 'checking', error: null \}\);/, 'before the awaited answer');
  assert.match(source, /refocus\.current = document\.activeElement === rowButton\(\);/);
  assert.match(source, /if \(document\.activeElement === document\.body\) rowButton\(\)\?\.focus\(\);/, 'only when focus fell to the page, never taken from elsewhere');
});
