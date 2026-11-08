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

// beta.14 (item 14): the row said "Could not check for updates." for EVERY error, a download that stopped included. Three failures, three sentences.
const stopped = (patch: Record<string, unknown>) => status({ status: 'error', available: '0.1.0-beta.14', transferred: 1000, total: 5000, error: 'The update download stopped.', ...patch } as Partial<UpdateStatus>);
test('a failed check keeps its sentence; a download that stopped names its version and when Acira tries again; a file that failed its check says it was not installed', () => {
  const now = 1_000_000_000_000;
  assert.equal(describe(status({ status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' }), now), 'Could not check for updates.', 'nothing known: a failed check');
  assert.match(describe(stopped({ interrupted: true, cause: 'network', retry: { failures: 1, at: now + 2 * 60_000 } }), now), /^Version 0\.1\.0-beta\.14 didn't download\. Acira tries again in 2\s?min/);
  assert.match(describe(stopped({ interrupted: true, cause: 'network', retry: { failures: 2, at: now + 90_000 } }), now), /in 2\s?min/, 'rounded up to a whole minute');
  assert.match(describe(stopped({ interrupted: true, cause: 'network', retry: { failures: 1, at: now + 5_000 } }), now), /in 1\s?min/, 'never "in 0 min"');
  assert.equal(describe(stopped({ interrupted: true, cause: 'network', retry: { failures: 4, at: null } }), now), "Version 0.1.0-beta.14 didn't download. Acira tries again later.", 'the ladder is used up: the regular round');
  assert.equal(describe(stopped({ interrupted: true, cause: 'other', retry: { failures: 1, at: null } }), now), "Version 0.1.0-beta.14 didn't download. Acira tries again later.", 'a full disk is a download that did not happen too');
  assert.equal(describe(stopped({ interrupted: true, cause: 'file', retry: { failures: 2, at: null } }), now), "This update couldn't be verified, so it wasn't installed.", 'damaged or refused (hash, signature)');
  assert.equal(describe(stopped({ interrupted: false, cause: 'network' }), now), 'Could not check for updates.', 'an old updater that does not say (no interrupted flag) reads as before');
});

test('Try again: only for a download that stopped, the same press as Check for updates (a manual check resumes the held bytes); a refused file offers nothing new', () => {
  assert.deepEqual(rowAction(stopped({ interrupted: true, cause: 'network' })), { action: 'update.check', disabled: false, retry: true });
  assert.deepEqual(rowAction(stopped({ interrupted: true, cause: 'other' })), { action: 'update.check', disabled: false, retry: true });
  assert.deepEqual(rowAction(stopped({ interrupted: true, cause: 'file' })), { action: 'update.check', disabled: false }, 'a file refused for its check: the button stays Check for updates');
  assert.deepEqual(rowAction(status({ status: 'error', error: 'x' })), { action: 'update.check', disabled: false }, 'a failed check: as before');
  const source = readFileSync('src/features/settings/panels/updates.tsx', 'utf8');
  assert.match(source, /button\.retry \? t\("updates\.tryAgain"\) : t\("updates\.checkForUpdates"\)/);
});

test('the four new sentences are in every catalog, with their {version} and {time}', () => {
  const read = (locale: string) => JSON.parse(readFileSync(`src/i18n/${locale}.json`, 'utf8')) as Record<string, string>;
  const wants: Record<string, string[]> = { 'updates.downloadFailedRetry': ['{version}', '{time}'], 'updates.downloadFailedLater': ['{version}'], 'updates.notVerified': [], 'updates.tryAgain': [] };
  for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN']) {
    const catalog = read(locale);
    for (const [id, parameters] of Object.entries(wants)) {
      assert.ok(catalog[id] && catalog[id].length > 1, `${locale}: ${id}`);
      for (const parameter of parameters) assert.ok(catalog[id].includes(parameter), `${locale}: ${id} keeps ${parameter}`);
      if (locale !== 'en') assert.notEqual(catalog[id], read('en')[id], `${locale}: ${id} is translated`);
    }
  }
});
