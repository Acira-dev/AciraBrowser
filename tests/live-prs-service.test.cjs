'use strict';
// Live pull requests (item 31): the folder's settings per profile, one refresher shared by a profile's windows, and nothing at all until the folder is added.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createLivePrs } = require('../desktop/live-prs/service.cjs');
const { mockRows, scriptedSource } = require('../desktop/live-prs/mock.cjs');
const { fakeClock } = require('./helpers/fake-clock.cjs');

const MIN = 60000;
const profile = (id = 'p1') => ({ id, name: 'Personal', partition: 'persist:' + id });
function make({ answers, file, clock = fakeClock() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-live-prs-'));
  const sources = [];
  const service = createLivePrs({ file: file ?? path.join(dir, 'live-prs.json'), sourceFor: (p) => { const source = scriptedSource(answers ?? [{ ok: true, rows: mockRows(clock.now()), more: false }]); sources.push([p.id, source]); return source; }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, warn: () => {} });
  const window = (extra = {}) => { const events = []; return { events, state: { alive: true, visible: true, ...extra }, listener: null }; };
  const listener = (w) => ({ emit: (event) => w.events.push(event), alive: () => w.state.alive, visible: () => w.state.visible });
  return { dir, clock, service, sources, window, listener, file: path.join(dir, 'live-prs.json'), cleanup: () => { service.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('off until added: a profile with no folder has no source, no timer and an answer of "no folder"', async () => {
  const t = make();
  try {
    const w = t.window();
    const answer = t.service.watch(profile(), t.listener(w));
    assert.equal(answer.folder, null); assert.equal(answer.supported, true);
    await t.clock.advance(60 * MIN);
    assert.equal(t.sources.length, 0, 'no source was even built'); assert.deepEqual(t.clock.pending(), []); assert.equal(fs.existsSync(t.file), false, 'nothing written');
    assert.equal(t.service.isRunning('p1'), false);
  } finally { t.cleanup(); }
});

test('private, Tor and secured windows are not offered it: unsupported, and add refuses a private or Tor profile', async () => {
  const t = make();
  try {
    assert.deepEqual(t.service.watch(profile(), t.listener(t.window()), { supported: false }), { supported: false, folder: null });
    assert.throws(() => t.service.add({ ...profile(), private: true }, t.listener(t.window())), /ordinary profiles/);
    assert.throws(() => t.service.add({ ...profile(), tor: true }, t.listener(t.window())), /ordinary profiles/);
    assert.throws(() => t.service.add({ id: '../x', partition: 'p' }, t.listener(t.window())), /ordinary profiles/);
    assert.equal(t.sources.length, 0);
  } finally { t.cleanup(); }
});

test('adding the folder saves it with the default filters, tells the windows, and the first load starts', async () => {
  const t = make();
  try {
    const w = t.window();
    const first = t.service.add(profile(), t.listener(w));
    assert.equal(first.folder.name, 'Pull requests'); assert.deepEqual(first.folder.filters, { author: true, review: true, assigned: true, mentioned: false, drafts: true, recent: false, repos: null });
    assert.equal(first.phase, 'loading'); assert.deepEqual(first.rows, []);
    await t.clock.flush();
    const loaded = t.service.status(profile());
    assert.equal(loaded.phase, 'ok'); assert.deepEqual(loaded.rows.map((row) => row.number), [412, 418, 405, 230], 'open and relevant; merged and closed wait for "Recently merged or closed"');
    assert.equal(loaded.total, 6); assert.deepEqual(loaded.repos, ['acme/browser', 'acme/docs', 'acme/website']);
    assert.ok(w.events.length >= 2 && w.events.every((event) => event.type === 'live-prs-changed' && event.profileId === 'p1'));
    assert.equal(JSON.parse(fs.readFileSync(t.file, 'utf8')).profiles.p1.folder.name, 'Pull requests');
    assert.deepEqual(t.sources[0][1].calls[0].relations, ['author', 'review', 'assigned']);
  } finally { t.cleanup(); }
});

test('the folder survives a restart: the next process reads the file, and a watching window starts its refresher', async () => {
  const t = make();
  try {
    t.service.add(profile(), t.listener(t.window())); await t.clock.flush();
    t.service.setFilters(profile(), { drafts: false, repos: ['acme/browser'] });
    t.service.shutdown();
    const second = make({ file: t.file, clock: t.clock });
    assert.equal(second.sources.length, 0);
    const answer = second.service.watch(profile(), second.listener(second.window()));
    assert.equal(answer.folder.filters.drafts, false); assert.deepEqual(answer.folder.filters.repos, ['acme/browser']);
    await t.clock.flush(); assert.equal(second.sources.length, 1); assert.equal(second.service.status(profile()).phase, 'ok');
    second.service.shutdown();
  } finally { t.cleanup(); }
});

test('filters change what is shown at once; one that needs rows the list lacks (Mentioned, Recently merged) asks the source again, one that only narrows does not', async () => {
  const t = make();
  try {
    t.service.add(profile(), t.listener(t.window())); await t.clock.flush();
    const calls = () => t.sources[0][1].calls.length;
    assert.equal(calls(), 1);
    assert.deepEqual(t.service.setFilters(profile(), { drafts: false }).rows.map((r) => r.number), [412, 418, 230]);
    assert.deepEqual(t.service.setFilters(profile(), { repos: ['acme/docs'] }).rows.map((r) => r.number), [230]);
    assert.equal(calls(), 1, 'narrowing needs no request');
    await t.clock.advance(15000);
    t.service.setFilters(profile(), { repos: null, recent: true }); await t.clock.flush();
    assert.equal(calls(), 2); assert.equal(t.sources[0][1].calls[1].recent, true);
    assert.ok(t.service.status(profile()).rows.some((row) => row.state === 'merged'));
    t.service.setFilters(profile(), { mentioned: true }); await t.clock.flush();
    assert.equal(calls(), 3); assert.deepEqual(t.sources[0][1].calls[2].relations, ['author', 'review', 'assigned', 'mentioned']);
    t.service.setFilters(profile(), { mentioned: false, nope: 1, drafts: 'x' }); await t.clock.flush();
    assert.equal(calls(), 3, 'turning one off asks nothing'); assert.equal(t.service.status(profile()).folder.filters.drafts, false, 'a wrong type is ignored, the value stays');
  } finally { t.cleanup(); }
});

test('hiding a row: gone until it changes, saved, and never a request to GitHub; a row that is not in the list is refused', async () => {
  const t = make();
  try {
    t.service.add(profile(), t.listener(t.window())); await t.clock.flush();
    const after = t.service.hide(profile(), 'acme/browser#412');
    assert.deepEqual(after.rows.map((row) => row.number), [418, 405, 230]); assert.equal(after.folder.hidden, 1);
    assert.equal(t.sources[0][1].calls.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(t.file, 'utf8')).profiles.p1.folder.hidden['acme/browser#412'].state, 'open');
    for (const bad of ['', 'x', '../../etc/passwd#1', 'acme/browser#', 5, null]) assert.throws(() => t.service.hide(profile(), bad), /Choose a pull request/);
    assert.equal(t.service.hide(profile(), 'acme/browser#9999').folder.hidden, 1, 'unknown row: nothing changes');
  } finally { t.cleanup(); }
});

test('rename: trimmed to one line, empty goes back to Pull requests', async () => {
  const t = make();
  try {
    t.service.add(profile(), t.listener(t.window()));
    assert.equal(t.service.rename(profile(), '  Reviews\n ').folder.name, 'Reviews'); assert.equal(t.service.rename(profile(), '   ').folder.name, 'Pull requests');
  } finally { t.cleanup(); }
});

test('removing the folder stops the timer, drops the settings and leaves nothing to ask GitHub; adding again starts clean', async () => {
  const t = make();
  try {
    t.service.add(profile(), t.listener(t.window())); await t.clock.flush();
    t.service.hide(profile(), 'acme/browser#412');
    assert.deepEqual(t.service.remove(profile()), { supported: true, folder: null });
    assert.equal(t.service.isRunning('p1'), false); assert.deepEqual(t.clock.pending(), []);
    assert.deepEqual(JSON.parse(fs.readFileSync(t.file, 'utf8')).profiles, {});
    await t.clock.advance(30 * MIN); assert.equal(t.sources[0][1].calls.length, 1, 'no request after removal');
    const again = t.service.add(profile(), t.listener(t.window())); assert.equal(again.folder.hidden, 0);
  } finally { t.cleanup(); }
});

test('removing the folder tells every window of the profile, so each sidebar drops it (found in the real app: the settings went but the folder stayed drawn)', async () => {
  const t = make();
  try {
    const a = t.window(), b = t.window();
    t.service.add(profile(), t.listener(a)); t.service.watch(profile(), t.listener(b)); await t.clock.flush();
    const heard = [a.events.length, b.events.length];
    t.service.remove(profile());
    assert.equal(a.events.length, heard[0] + 1, 'the window that removed it hears it'); assert.equal(b.events.length, heard[1] + 1, 'and so does the other');
    assert.equal(t.service.status(profile()).folder, null, 'what they ask next says there is no folder');
  } finally { t.cleanup(); }
});

test('two windows of one profile share one source and one timer; each gets the change events; a closed window is dropped', async () => {
  const t = make();
  try {
    const a = t.window(), b = t.window();
    t.service.add(profile(), t.listener(a)); t.service.watch(profile(), t.listener(b)); await t.clock.flush();
    assert.equal(t.sources.length, 1, 'one source'); assert.equal(t.sources[0][1].calls.length, 1);
    assert.ok(a.events.length > 0 && b.events.length > 0);
    b.state.alive = false; const before = b.events.length;
    await t.clock.advance(5 * MIN); assert.equal(t.sources[0][1].calls.length, 2, 'one request for both windows');
    assert.equal(b.events.length, before, 'the closed window hears nothing');
  } finally { t.cleanup(); }
});

test('a profile whose windows are all minimised or closed asks nothing', async () => {
  const t = make();
  try {
    const w = t.window();
    t.service.add(profile(), t.listener(w)); await t.clock.flush();
    w.state.visible = false; await t.clock.advance(30 * MIN); assert.equal(t.sources[0][1].calls.length, 1);
    w.state.visible = true; t.service.noteVisible('p1'); await t.clock.flush(); assert.equal(t.sources[0][1].calls.length, 2);
  } finally { t.cleanup(); }
});

test('two profiles are separate: their own folder, rows, source and filters', async () => {
  const t = make();
  try {
    t.service.add(profile('p1'), t.listener(t.window())); await t.clock.flush();
    assert.equal(t.service.status(profile('p2')).folder, null);
    t.service.add(profile('p2'), t.listener(t.window())); t.service.setFilters(profile('p2'), { author: false }); await t.clock.flush();
    assert.equal(t.service.status(profile('p1')).folder.filters.author, true); assert.equal(t.service.status(profile('p2')).folder.filters.author, false);
    assert.equal(t.sources.length, 2);
  } finally { t.cleanup(); }
});

test('signed out and error answers reach the sidebar as phases, with the reason', async () => {
  const t = make({ answers: [{ ok: false, reason: 'signed-out' }] });
  try {
    t.service.add(profile(), t.listener(t.window())); await t.clock.flush();
    const out = t.service.status(profile()); assert.equal(out.phase, 'signed-out'); assert.deepEqual(out.rows, []);
    assert.equal(t.service.refresh(profile()).refresh, 'started', 'Check again');
  } finally { t.cleanup(); }
  const u = make({ answers: [{ ok: true, rows: mockRows(fakeClock().now()), more: true }, { ok: false, reason: 'rate-limited', retryAfterMs: 10 * MIN }] });
  try {
    u.service.add(profile(), u.listener(u.window())); await u.clock.flush(); assert.equal(u.service.status(profile()).more, true);
    await u.clock.advance(5 * MIN); const out = u.service.status(profile());
    assert.equal(out.phase, 'error'); assert.equal(out.error, 'rate-limited'); assert.equal(out.rows.length, 4, 'the last rows stay'); assert.equal(u.service.refresh(profile()).refresh, 'wait');
  } finally { u.cleanup(); }
});

test('a damaged settings file is kept aside and the service starts with no folder; a file that is the wrong shape is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-live-prs-bad-')), file = path.join(dir, 'live-prs.json');
  try {
    for (const text of ['{broken', JSON.stringify({ v: 2, profiles: {} }), JSON.stringify({ v: 1, profiles: [] }), JSON.stringify([1])]) {
      fs.writeFileSync(file, text);
      const service = createLivePrs({ file, sourceFor: () => scriptedSource([{ ok: true, rows: [] }]), warn: () => {} });
      assert.equal(service.status(profile()).folder, null, text); service.shutdown();
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
