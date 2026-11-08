import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';
import type { UpdateStatus } from '../src/runtime/nativeNetwork';

// Beta.14, item 13 (critical): a downloading update vanished from the top bar after a switch to Sidebar + address and back. The toolbar's buttons (the Update pill
// among them) are mounted in the sidebar's row in that layout and in the top bar in the others, so a layout switch mounts the pill again. It used to start with
// nothing on every mount and swallow a first read that failed, leaving nothing until main's next 'update-changed' (a paused or finished download sends none).
// The status is now held once for the page (createUpdateStore): a mount shows it at once, a failed read keeps it and tries again, and a late older read is dropped.
// The download itself is main's and is not touched by any layout (the live rig, qa/update-layout-switch, checks that against the real app).
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
(globalThis as { window?: unknown }).window ??= {}; // the runtime client reads window.acira at import
const { createUpdateStore } = await import('../src/features/updates/useUpdateReady');
const { rowAction } = await import('../src/features/settings/updateRow');
const read = (file: string) => readFileSync(file, 'utf8');

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({ status: 'downloading', available: '0.1.0-beta.14', progress: 40, pausable: true, ...patch } as UpdateStatus);
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A source whose reads the test answers one by one, and whose 'update-changed' the test sends. */
function source() {
  const reads: Array<{ resolve: (value: UpdateStatus | undefined) => void; reject: (error: unknown) => void }> = [];
  let changed: (() => void) | null = null, subscribers = 0;
  return {
    reads, send: () => changed?.(), subscribers: () => subscribers,
    read: () => new Promise<UpdateStatus | undefined>((resolve, reject) => { reads.push({ resolve, reject }); }),
    subscribe: (fn: () => void) => { changed = fn; subscribers++; return () => { subscribers--; }; },
  };
}
/** Timers the test runs by hand. */
function clock() {
  const timers: Array<{ at: number; fn: () => void; id: number }> = [], repeats = new Map<number, { every: number; fn: () => void }>();
  let id = 0, now = 0;
  return {
    setTimer: ((fn: () => void, wait: number) => { timers.push({ at: now + wait, fn, id: ++id }); return id; }) as unknown as typeof setTimeout,
    clearTimer: ((handle: number) => { const index = timers.findIndex((timer) => timer.id === handle); if (index >= 0) timers.splice(index, 1); }) as unknown as typeof clearTimeout,
    setRepeat: ((fn: () => void, every: number) => { repeats.set(++id, { every, fn }); return id; }) as unknown as typeof setInterval,
    clearRepeat: ((handle: number) => { repeats.delete(handle); }) as unknown as typeof clearInterval,
    pending: () => timers.length, repeating: () => repeats.size,
    advance(ms: number) { now += ms; for (const timer of timers.filter((item) => item.at <= now).sort((a, b) => a.at - b.at)) { timers.splice(timers.indexOf(timer), 1); timer.fn(); } for (const repeat of repeats.values()) repeat.fn(); },
  };
}

test('a mount that comes after the first one shows the held status at once, nothing to read first', async () => {
  const feed = source(), store = createUpdateStore(feed, clock());
  const stopPill = store.subscribe(() => undefined); // the pill in the top bar
  feed.reads[0].resolve(status());
  await tick();
  assert.equal(store.get()?.progress, 40);
  stopPill(); // the layout switch: the pill unmounts here...
  const before = store.version();
  const stopAgain = store.subscribe(() => undefined); // ...and mounts again in the sidebar's row
  assert.equal(store.get()?.status, 'downloading', 'the new mount sees the download immediately, with no empty frame');
  assert.equal(store.version(), before, 'and nothing was reset');
  assert.equal(feed.subscribers(), 1, 'one listener for the page, however many times the pill mounts');
  stopAgain();
  assert.equal(feed.subscribers(), 1, 'it stays through the gap between two mounts: no event is missed');
});

test('a first read that fails is tried again (1 s, 3 s, 10 s) instead of leaving the pill empty until the next event', async () => {
  const feed = source(), time = clock(), store = createUpdateStore(feed, time);
  store.subscribe(() => undefined);
  feed.reads[0].reject(new Error('busy'));
  await tick();
  assert.equal(store.get(), undefined);
  assert.equal(time.pending(), 1, 'a retry is waiting');
  time.advance(1000);
  assert.equal(feed.reads.length, 2, 'it reads again after a second');
  feed.reads[1].reject(new Error('busy'));
  await tick();
  time.advance(3000);
  assert.equal(feed.reads.length, 3);
  feed.reads[2].resolve(status({ status: 'paused', progress: 12 }));
  await tick();
  assert.equal(store.get()?.status, 'paused', 'a paused download, which sends no event, shows after the retry');
  assert.equal(time.pending(), 0);
});

test('a failed read keeps what was known; a late older read does not undo a newer one', async () => {
  const feed = source(), store = createUpdateStore(feed, clock());
  store.subscribe(() => undefined);
  feed.reads[0].resolve(status({ progress: 10 }));
  await tick();
  store.refresh(); // read A
  store.refresh(); // read B, newer
  feed.reads[2].resolve(status({ progress: 55 }));
  await tick();
  feed.reads[1].resolve(status({ progress: 30 })); // A comes back late
  await tick();
  assert.equal(store.get()?.progress, 55, 'the newer answer stands');
  store.refresh();
  feed.reads[3].reject(new Error('gone'));
  await tick();
  assert.equal(store.get()?.progress, 55, 'a failed read leaves the download on screen');
});

test("main's 'update-changed' and the window being looked at read the status again; each read moves the counter so effects keyed on it run", async () => {
  const feed = source(), store = createUpdateStore(feed, clock());
  store.subscribe(() => undefined);
  feed.reads[0].resolve(status());
  await tick();
  const first = store.version();
  feed.send();
  feed.reads[1].resolve(status({ progress: 41 }));
  await tick();
  assert.equal(store.get()?.progress, 41);
  assert.ok(store.version() > first);
  store.nudge();
  assert.equal(feed.reads.length, 3, 'a focus or a return to the window reads once more');
});

test('while a download runs it is looked at now and then; the look stops with the download and with the last mount', async () => {
  const feed = source(), time = clock(), store = createUpdateStore(feed, time);
  const stop = store.subscribe(() => undefined);
  feed.reads[0].resolve(status());
  await tick();
  assert.equal(time.repeating(), 1, 'downloading: a safety look every few seconds');
  store.refresh();
  feed.reads[1].resolve(status({ status: 'ready', progress: 100 }));
  await tick();
  assert.equal(time.repeating(), 0, 'ready: nothing to look at (it sends its own change)');
  store.refresh();
  feed.reads[2].resolve(status());
  await tick();
  assert.equal(time.repeating(), 1);
  stop();
  assert.equal(time.repeating(), 0, 'no mounts: no timer');
});

test('the Update pill is in the toolbar\'s buttons, which sit in the top bar or in the sidebar\'s row: one place in the code, so both layouts show the same pill', () => {
  const app = read('src/App.tsx');
  assert.equal((app.match(/<UpdatePill /g) || []).length, 1, 'one pill, in `actions`');
  assert.match(app, /const actions = <div className="toolbar-actions">[^]*<UpdatePill onOpen=\{\(\) => open\('update'\)\}/);
  assert.match(app, /\{addrBlock \? <AddressMore [^>]*>[^]*\{actions\}<\/AddressMore> : actions\}/, 'the same buttons in the sidebar\'s row (Sidebar + address) and in the top bar');
  const hook = read('src/features/updates/useUpdateReady.ts');
  assert.match(hook, /useSyncExternalStore\(store\.subscribe, store\.version, store\.version\)/, 'a mount reads the page\'s held status, not a status of its own');
  assert.doesNotMatch(hook, /useState/, 'no per-mount copy that starts empty');
});

test('the last resort main offers after repeated failures is one quiet link line, only ever to acirabrowser.com, in the update panel and in Settings > Updates', async () => {
  const { lastResortUrl } = await import('../src/features/updates/useUpdateReady');
  const one = (url: unknown) => lastResortUrl(status({ lastResort: { url, platform: 'mac', arch: 'arm64', version: '0.1.0-beta.14', kind: 'zip' } } as Partial<UpdateStatus>));
  assert.equal(one('https://acirabrowser.com/download/'), 'https://acirabrowser.com/download/');
  assert.equal(one('https://evil.example/download/'), null, 'any other address is never opened');
  assert.equal(one('http://acirabrowser.com/download/'), null);
  assert.equal(one('https://acirabrowser.com.evil.example/'), null);
  assert.equal(lastResortUrl(status({ lastResort: null })), null);
  assert.equal(lastResortUrl(status()), null, 'absent: nothing shown');
  assert.match(read('src/runtime/nativeNetwork.ts'), /lastResort\?:\{url:string;platform:'mac'\|'windows'\|'linux';arch:'arm64'\|'x64'\|null;version:string\|null;kind:string\}\|null;/);
  assert.match(read('src/features/updates/UpdatePopover.tsx'), /update\.lastResort && !reading && <button type="button" className="acira-button acira-button-quiet" onClick=\{\(\) => \{ void runtime\.dispatch\(\{ type: 'tab\.new', url: update\.lastResort! \}\)/);
  assert.match(read('src/features/settings/panels/updates.tsx'), /lastResortUrl\(status\) && <SettingNote><button type="button" className="acira-button acira-button-quiet" onClick=\{\(\) => void runtime\.dispatch\(\{ type: 'tab\.new', url: lastResortUrl\(status\)! \}\)\}>\{t\('update\.lastResort'\)\}/);
});

test('Restart to update stays pressable while the update is ready, whatever error main also reports (an install whose quit never came)', () => {
  assert.deepEqual(rowAction(status({ status: 'ready', error: 'Acira did not restart to install the update.' })), { action: 'update.install', disabled: false });
  assert.match(read('src/features/updates/UpdatePopover.tsx'), /disabled=\{busy \|\| !update\} onClick=\{install\}/, 'the panel\'s Install now only waits for its own press (8 s), not for an error');
  assert.match(read('src/components/BrowserMenu.tsx'), /function UpdateRow[^]*if\(!version\)return null;[^]*restartToUpdate/);
});
