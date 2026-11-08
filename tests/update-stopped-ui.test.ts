import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import type { UpdateStatus } from '../src/runtime/nativeNetwork';

// 13.2: a download that stopped is not a vanished pill. Main keeps the version and its bytes and says status 'error' with `interrupted`, `retry`, `cause` and `lastResort`
// (app-updater.cjs); the Update pill keeps its dots, held and dimmed, with a tooltip that says when Acira tries again, and its panel says why, when, and offers Try again
// (update.check) and, when main sets lastResort, the download page on acirabrowser.com. While main looks again before a retry ('checking', the bytes still held) the stopped look
// stays with "Retrying…": the live rig measured the pill missing for the length of that look (3 s with a lagging feed) before this.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= {};
const { updateView, errorLines, formatRetryIn } = await import('../src/features/updates/useUpdateReady');
const { errorTip } = await import('../src/features/updates/UpdatePill');
const read = (file: string) => readFileSync(file, 'utf8');

const LR = { url: 'https://acirabrowser.com/download/', platform: 'mac', arch: 'arm64', version: '0.1.0-beta.14', kind: 'server' };
const stopped = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({ status: 'error', available: '0.1.0-beta.14', progress: 67, transferred: 16.1e6, total: 24e6, interrupted: true, cause: 'network', retry: { failures: 1, at: Date.now() + 118000 }, lastResort: null, ...patch } as UpdateStatus);

test('a stopped download is shown (phase error) with when, how often and why; a failed look with nothing known stays invisible', () => {
  const view = updateView(stopped())!;
  assert.equal(view.phase, 'error');
  assert.equal(view.version, '0.1.0-beta.14');
  assert.equal(view.percent, 67);
  assert.equal(view.cause, 'network');
  assert.equal(view.failures, 1);
  assert.ok(view.retryAt && view.retryAt > Date.now());
  assert.equal(view.retrying, false);
  assert.equal(updateView(stopped({ interrupted: false })), null, 'an error before any download began shows nothing');
  assert.equal(updateView(stopped({ available: null, interrupted: false })), null, 'a failed check with nothing known shows nothing');
  assert.equal(updateView(undefined), null);
});

test('the look main makes before a retry keeps the stopped look (the pill does not go away for it); a look with nothing held does not show one', () => {
  const looking = updateView({ ...stopped(), status: 'checking', interrupted: false, cause: null, retry: { failures: 1, at: null } } as UpdateStatus)!;
  assert.equal(looking.phase, 'error');
  assert.equal(looking.retrying, true);
  assert.equal(looking.retryAt, null);
  assert.equal(updateView({ ...stopped(), status: 'checking', interrupted: false, total: null, transferred: null } as UpdateStatus), null, 'a first look shows nothing');
  assert.equal(updateView({ status: 'checking', available: null } as UpdateStatus), null);
});

test('downloading, paused and ready are as they were', () => {
  assert.equal(updateView(stopped({ status: 'downloading', interrupted: false }))!.phase, 'downloading');
  assert.equal(updateView(stopped({ status: 'paused', interrupted: false }))!.phase, 'paused');
  const ready = updateView(stopped({ status: 'ready', interrupted: false, lastResort: LR as never }))!;
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.lastResort, 'https://acirabrowser.com/download/');
  assert.equal(updateView(stopped({ status: 'ready', interrupted: false, error: 'x' } as never))!.phase, 'ready', 'a finished update with an error text stays pressable');
});

test('the panel lines: why and how much is here, then when it tries again', () => {
  const lines = errorLines(updateView(stopped())!);
  assert.match(lines.what, /^Connection failed · 16\.1 of 24 MB$/);
  assert.match(lines.when!, /^Retrying in 2 min$/);
  assert.equal(errorLines(updateView(stopped({ retry: { failures: 1, at: Date.now() + 20000 } }))!).when, 'Retrying…', 'under a minute away');
  assert.equal(errorLines(updateView(stopped({ retry: { failures: 5, at: null } }))!).when, 'Acira tries again later');
  assert.match(errorLines(updateView(stopped({ cause: 'other' }))!).what, /^Something went wrong · 16\.1 of 24 MB$/);
  assert.deepEqual(errorLines(updateView(stopped({ cause: 'file' }))!), { what: "This update couldn't be verified, so it wasn't installed.", when: null }, "a file that failed its check says so in Settings' words");
  const looking = errorLines(updateView({ ...stopped(), status: 'checking', interrupted: false, cause: null } as UpdateStatus)!);
  assert.deepEqual(looking, { what: '16.1 of 24 MB', when: 'Retrying…' });
  assert.equal(formatRetryIn(1000 + 10 * 60000, 1000), 'Retrying in 10 min');
});

test('the pill\'s tooltip says which update stopped and when it tries again', () => {
  assert.match(errorTip(updateView(stopped())!), /^Update to Acira 0\.1\.0-beta\.14 stopped\nRetrying in 2 min$/);
  assert.match(errorTip(updateView(stopped({ retry: { failures: 5, at: null } }))!), /\nOpen it to try again\.$/);
  assert.match(errorTip(updateView(stopped({ cause: 'file' }))!), /\nThis update couldn't be verified, so it wasn't installed\.$/);
  assert.match(errorTip(updateView({ ...stopped(), status: 'checking', interrupted: false } as UpdateStatus)!), /\nRetrying…$/);
});

test('the panel: Try again is update.check (not offered for a file that failed its check, off while main looks), the last resort opens acirabrowser.com in a new tab, in the download and the ready panel', () => {
  const source = read('src/features/updates/UpdatePopover.tsx'), hook = read('src/features/updates/useUpdateReady.ts');
  assert.match(hook, /tryAgainUpdate = \(\) => runtime\.service\(\{ type: 'update\.check' \}\)/);
  assert.match(source, /update\.cause !== 'file' && <button[^>]*disabled=\{update\.retrying\}[^>]*onClick=\{\(\) => void tryAgainUpdate\(\)\}>\{t\('updates\.tryAgain'\)\}/);
  assert.equal((source.match(/runtime\.dispatch\(\{ type: 'tab\.new', url: update\.lastResort!? \}\)/g) || []).length, 3, 'stopped, download links and ready panel');
  assert.match(source, /update\?\.lastResort && !reading/, 'the ready panel offers it too (two installs that did not take)');
  assert.match(source, /update\.cause === 'file' \? 'update-pop-actions update-pop-links' : 'update-pop-actions'/, 'a lone link sits on the text edge');
});

test('Settings and the panel use the same words: the strings update-safe added for Settings are reused, not copied', () => {
  const hook = read('src/features/updates/useUpdateReady.ts'), settings = read('src/features/settings/updateRow.ts'), en = JSON.parse(read('src/i18n/en.json')) as Record<string, string>;
  for (const id of ['updates.notVerified', 'updates.tryAgain']) { assert.ok(en[id], id); assert.ok(hook.includes(`'${id}'`) || read('src/features/updates/UpdatePopover.tsx').includes(`'${id}'`), `${id} is used by the panel`); }
  assert.ok(settings.includes("t('updates.notVerified')"));
  for (const id of ['update.tryAgain', 'update.causeFile']) assert.equal(en[id], undefined, `${id} was a copy`);
});
