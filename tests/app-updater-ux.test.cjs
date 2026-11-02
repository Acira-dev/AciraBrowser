'use strict';
// The update UX state machine: downloaded -> pill + menu row, Restart saves the session and only then calls quitAndInstall, the first launch on a new
// version gets one "updated" note (never on a fresh install, never twice). The stand-in updater is what the real-app rig uses: no installer ever runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createAppUpdater, notesText, CHECK_EVERY } = require('../desktop/browser-services/app-updater.cjs');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acira-updater-'));
const app = (version = '1.0.0') => ({ getVersion: () => version, isPackaged: true, getPath: () => os.tmpdir() });
function fakeUpdater(order = []) {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { updater.emit('checking-for-update'); updater.emit('update-available', { version: '1.1.0' }); updater.emit('update-downloaded', { version: '1.1.0', releaseNotes: '<p>Faster <b>start-up</b>.</p><ul><li>One</li><li>Two &amp; three</li></ul>' }); return null; };
  updater.quitAndInstall = (...args) => order.push(['quitAndInstall', ...args]);
  updater.setFeedURL = () => undefined;
  return updater;
}
const make = (dir, extra = {}) => createAppUpdater({ app: app(extra.version), dir, platform: 'win32', env: {}, uninstallerPresent: () => true, qaBuild: false, schedule: () => null, every: () => null, ...extra });

test('downloaded -> status ready with the version, and the interface is told', async () => {
  const dir = folder(), changes = [];
  const updater = make(dir, { autoUpdater: fakeUpdater(), onChange: status => changes.push(status.status) });
  assert.equal(updater.status().status, 'idle');
  await updater.check();
  const status = updater.status();
  assert.equal(status.status, 'ready'); assert.equal(status.available, '1.1.0'); assert.equal(status.progress, 100);
  assert.ok(changes.includes('ready'), 'onChange fires so every window can show the pill and the menu row');
});

test('restart saves the session first, then calls quitAndInstall (never before)', async () => {
  const dir = folder(), order = [];
  const updater = make(dir, { autoUpdater: fakeUpdater(order), beforeInstall: async () => { await new Promise(resolve => setTimeout(resolve, 30)); order.push(['flushed']); } });
  await assert.rejects(updater.install(), /No downloaded update/, 'nothing to install before a download finished');
  await updater.check();
  const result = await updater.install();
  assert.equal(result.installing, true);
  assert.deepEqual(order, [['flushed'], ['quitAndInstall', true, true]]);
  await updater.install(); // a second click while installing does nothing more
  assert.equal(order.filter(row => row[0] === 'quitAndInstall').length, 1);
});

test('a failing session save does not trap the person in the old version', async () => {
  const order = [];
  const updater = make(folder(), { autoUpdater: fakeUpdater(order), beforeInstall: async () => { throw new Error('disk busy'); } });
  await updater.check(); await updater.install();
  assert.deepEqual(order, [['quitAndInstall', true, true]]);
});

test('the notes are kept with the downloaded version and read as plain text', async () => {
  const dir = folder();
  const updater = make(dir, { autoUpdater: fakeUpdater() });
  await updater.check();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'updater.json'), 'utf8'));
  assert.equal(saved.pending.version, '1.1.0');
  assert.equal(saved.pending.notes, 'Faster start-up.\n• One\n• Two & three');
  assert.equal(notesText(['A', { version: '1', note: 'B **bold**' }]), 'A\nB bold');
  assert.equal(notesText(undefined), '');
  assert.ok(notesText('x'.repeat(5000)).length <= 1000);
  assert.equal(/<|>/.test(notesText('<script>alert(1)</script>Hi')), false, 'markup never reaches the sheet');
});

test('first launch on a new version: one note with the persisted notes, then never again', async () => {
  const dir = folder();
  // launch 1 (1.0.0): downloads 1.1.0
  const first = make(dir, { autoUpdater: fakeUpdater() });
  assert.equal(first.whatsNewInfo(), null, 'a fresh install shows no note');
  await first.check();
  // launch 2 (1.1.0): the installer ran
  const second = make(dir, { version: '1.1.0' });
  assert.deepEqual(second.whatsNewInfo(), { version: '1.1.0', notes: 'Faster start-up.\n• One\n• Two & three' });
  // launch 3 (still 1.1.0): never again
  assert.equal(make(dir, { version: '1.1.0' }).whatsNewInfo(), null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'updater.json'), 'utf8')).pending, undefined, 'the spent notes are dropped');
});

test('a version change without stored notes still gets the note (the sheet falls back to a short line); an older file is not an update', () => {
  const dir = folder();
  assert.equal(make(dir, { version: '1.0.0' }).whatsNewInfo(), null);
  assert.deepEqual(make(dir, { version: '1.0.1' }).whatsNewInfo(), { version: '1.0.1', notes: '' });
  const legacy = folder();
  fs.writeFileSync(path.join(legacy, 'updater.json'), JSON.stringify({ autoDownload: true, channel: 'stable' }));
  assert.equal(make(legacy, { version: '1.0.0' }).whatsNewInfo(), null, 'a file from before this feature has no lastRunVersion');
  assert.equal(make(legacy, { version: '1.0.0' }).whatsNewInfo(), null);
});

test('test mode: the stand-in updater finds, "downloads" and records quitAndInstall; no installer runs', async () => {
  const dir = folder(), env = { ACIRA_UPDATE_TEST: '1', ACIRA_UPDATE_STUB: '1', ACIRA_UPDATE_STUB_VERSION: '2.0.0' }, changes = [];
  const updater = createAppUpdater({ app: { getVersion: () => '1.0.0', isPackaged: false, getPath: () => dir }, dir, env, onChange: s => changes.push(s.status), schedule: () => null, every: () => null, qaBuild: false, beforeInstall: async () => { await new Promise(resolve => setTimeout(resolve, 10)); } });
  assert.equal(updater.status().supported, true);
  await updater.check();
  for (let i = 0; i < 40 && updater.status().status !== 'ready'; i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(updater.status().status, 'ready'); assert.equal(updater.status().available, '2.0.0');
  await updater.install();
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'update-stub-log.json'), 'utf8')).map(row => typeof row.event === 'string' ? row.event : Object.keys(row.event)[0]);
  assert.deepEqual(log, ['session-flushed', 'quitAndInstall']);
  // and a version bump by env rehearses the note
  const bumped = createAppUpdater({ app: { getVersion: () => '1.0.0', isPackaged: false, getPath: () => dir }, dir, env: { ...env, ACIRA_UPDATE_TEST_VERSION: '2.0.0' }, schedule: () => null, every: () => null, qaBuild: false });
  assert.equal(bumped.whatsNewInfo().version, '2.0.0'); assert.match(bumped.whatsNewInfo().notes, /calmer, faster start-up/);
});

test('outside test mode a development run never updates itself', () => {
  const updater = createAppUpdater({ app: { getVersion: () => '1.0.0', isPackaged: false, getPath: () => folder() }, dir: folder(), env: { ACIRA_UPDATE_STUB: '1' }, schedule: () => null, every: () => null, qaBuild: false });
  assert.equal(updater.status().supported, false);
  assert.equal(CHECK_EVERY, 8 * 60 * 60 * 1000);
});

test('the interface is wired: pill beside the menu button, a top menu row, and a quiet toast when the new version came without notes', () => {
  const app_ = read('src', 'App.tsx'), menu = read('src', 'components', 'BrowserMenu.tsx'), main = read('desktop', 'main.cjs'), validation = read('desktop', 'validation.cjs'), core = read('src', 'runtime', 'core.ts');
  const pillAt = app_.indexOf('<UpdatePill '); assert.ok(pillAt > 0 && pillAt < app_.indexOf('<IconButton className="toolbar-menu-control"'), 'the pill sits just before the Acira menu button');
  assert.ok(menu.indexOf('<UpdateRow row={row}/>') > 0 && menu.indexOf('<UpdateRow row={row}/>') < menu.indexOf('<MenuList ids={layout.main}'), 'the row tops the menu');
  assert.match(main, /beforeInstall:flushForUpdate/); assert.match(main, /type:'update-changed'/); assert.match(main, /\{update:await appUpdater\.install\(\)\}/, 'install is async (session flush first): the service handler awaits it, a Promise cannot cross IPC');
  assert.match(main, /function announceUpdate\(note,tries\)\{if\(!note\|\|note\.notes\)return;/, 'with notes the popup shows them; the toast is only for a new version without notes');
  assert.doesNotMatch(main, /update\.whatsnew/); assert.doesNotMatch(validation, /update\.whatsnew/); assert.doesNotMatch(main, /showMessageBox\(mainWindow,\{type:'info',title:tx\.t\('update\.whatsNew'\)/, 'the old native dialog, placed by absolute screen coordinates in the upper third, is gone');
  assert.match(core, /update\.type==='update-changed'/); assert.match(core, /action\.i18n&&Object\.hasOwn\(enMessages,action\.i18n\.id\)/);
});

test('every new message is in all 13 catalogs with its {version} parameter', () => {
  const ids = ['update.pill', 'update.pillTip', 'update.restartRow', 'update.updatedTo', 'update.whatsNew', 'update.noNotes', 'update.close'];
  const files = fs.readdirSync(path.join(root, 'src', 'i18n')).filter(name => /^[A-Za-z-]+\.json$/.test(name) && name !== 'converted.json');
  assert.equal(files.length, 13);
  for (const file of files) {
    const catalog = JSON.parse(read('src', 'i18n', file));
    for (const id of ids) assert.ok(catalog[id] && catalog[id].length > 1, `${file} lacks ${id}`);
    for (const id of ['update.pillTip', 'update.updatedTo']) assert.match(catalog[id], /\{version\}/, `${file} ${id}`);
  }
});

// Round 6: the founder's update design. Download dot with real progress, one question when it is ready, Read more, a quiet way back.
function progressUpdater(fire) {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { updater.emit('checking-for-update'); updater.emit('update-available', { version: '1.2.0' }); fire(updater); return null; };
  updater.quitAndInstall = () => undefined; updater.setFeedURL = () => undefined;
  return updater;
}

test('download progress is real (bytes, size, speed), reaches the interface at most every 400 ms and only when the percent moved', async () => {
  let clock = 1000; const changes = [];
  const updater = make(folder(), { now: () => clock, autoUpdater: progressUpdater(u => {
    for (const [percent, at] of [[1, 1000], [1.2, 1100], [2, 1200], [2, 1500], [3, 1700], [3.2, 1800], [100, 1810]]) { clock = at; u.emit('download-progress', { percent, transferred: percent * 3820000, total: 382000000, bytesPerSecond: 5e6 }); }
  }), onChange: status => changes.push([status.status, status.progress]) });
  await updater.check();
  const downloading = changes.filter(([status]) => status === 'downloading').map(([, progress]) => progress);
  assert.deepEqual(downloading, [null, 1, 2, 100], 'one event for the start, then the percent when it moved and 400 ms passed (2% at 1500 not 1200; 3% at 1700 is too soon after it), and always the end');
  const status = updater.status();
  assert.equal(status.progress, 100); assert.equal(status.status, 'downloading'); assert.equal(status.total, 382000000); assert.equal(status.transferred, 382000000); assert.equal(status.speed, 5000000);
});

test('the finished download carries its plain-text notes and asks once: Later never brings the question back', async () => {
  const changes = [];
  const updater = make(folder(), { autoUpdater: progressUpdater(u => u.emit('update-downloaded', { version: '1.2.0', releaseNotes: '## Fixed\n- [Faster tabs](https://example.com/x) <img src=x onerror=alert(1)>\n<script>alert(1)</script>**Calmer** updates' })), onChange: status => changes.push(status.prompt) });
  assert.equal(updater.status().prompt, false, 'nothing to ask before a download');
  await updater.check();
  const ready = updater.status();
  assert.equal(ready.status, 'ready'); assert.equal(ready.prompt, true);
  assert.equal(ready.notes, 'Fixed\n• Faster tabs\nalert(1)Calmer updates', 'links keep their text, tags and markdown are gone, only text remains');
  assert.equal(/[<>]|https?:/.test(ready.notes), false, 'no markup and no network address reaches the interface');
  assert.equal(updater.claimPrompt().claimed, true, 'the first window to ask gets the question');
  assert.equal(updater.status().prompt, false);
  assert.equal(updater.claimPrompt().claimed, false, 'every other window, and every later look, gets nothing');
  assert.equal(changes.at(-1), false, 'every window is told it was asked');
  await updater.check(); assert.equal(updater.status().prompt, false, 'the same download found again (the 8-hour check) is not asked about again');
  assert.equal(updater.status().status, 'ready', 'Later leaves it ready: the pill and the menu row stay');
});

test('a newer version after Later asks again with its own notes; nothing is asked while downloading or when unsupported', async () => {
  let version = '1.2.0';
  const updater = make(folder(), { autoUpdater: progressUpdater(u => u.emit('update-downloaded', { version, releaseNotes: 'Notes ' + version })) });
  await updater.check(); assert.equal(updater.claimPrompt().claimed, true);
  version = '1.3.0'; await updater.check(); assert.equal(updater.status().notes, 'Notes 1.3.0'); assert.equal(updater.status().prompt, true); assert.equal(updater.claimPrompt().claimed, true);
  const downloading = make(folder(), { autoUpdater: progressUpdater(u => u.emit('download-progress', { percent: 10 })) }); await downloading.check();
  assert.equal(downloading.status().prompt, false); assert.equal(downloading.claimPrompt().claimed, false);
  const portable = make(folder(), { uninstallerPresent: () => false, autoUpdater: progressUpdater(() => undefined) }); assert.equal(portable.status().prompt, false); assert.equal(portable.claimPrompt().claimed, false);
});

test('automatic download is the default; the Settings switch turns it off and the status says so', async () => {
  const dir = folder(), updater = make(dir, { autoUpdater: progressUpdater(() => undefined) });
  assert.equal(updater.status().autoDownload, true, 'on by default');
  assert.equal(updater.setAutoDownload(false).autoDownload, false);
  assert.equal(make(dir, { autoUpdater: progressUpdater(() => undefined) }).status().autoDownload, false, 'the choice is kept');
  let seen; const fake = progressUpdater(() => undefined); Object.defineProperty(fake, 'autoDownload', { set(value) { seen = value; }, get() { return seen; } });
  await make(folder(), { autoUpdater: fake }).check();
  assert.equal(seen, true, 'electron-updater is told to download by itself');
});

test('the stand-in updater downloads from a local feed for real, so the proof shows true progress', async () => {
  const http = require('node:http'), body = Buffer.alloc(300000, 7);
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('latest.yml')) { res.setHeader('content-type', 'text/yaml'); return res.end(JSON.stringify({ version: '1.2.0', releaseNotes: 'Local notes', files: [{ url: 'Setup.exe', size: body.length }] })); }
    res.setHeader('content-length', body.length); res.write(body.subarray(0, 100000)); setTimeout(() => res.end(body.subarray(100000)), 60);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const feed = 'http://127.0.0.1:' + server.address().port + '/', seen = [];
    const updater = make(folder(), { env: { ACIRA_UPDATE_TEST: '1', ACIRA_UPDATE_STUB: '1', ACIRA_UPDATE_FEED: feed }, onChange: status => seen.push(status.status + ':' + status.progress) });
    await updater.check();
    for (let i = 0; i < 150 && updater.status().status !== 'ready'; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(updater.status().status, 'ready'); assert.equal(updater.status().notes, 'Local notes'); assert.equal(updater.status().total, body.length);
    assert.ok(seen.some(row => { const percent = Number(row.split(':')[1]); return row.startsWith('downloading:') && percent > 0 && percent < 100; }), 'a real partial percent was seen: ' + seen.join(' '));
  } finally { server.close(); }
});

test('the update popup, the dot and the pill are wired through the one popup system, with no markup from the network', () => {
  const app_ = read('src', 'App.tsx'), validation = read('desktop', 'validation.cjs'), popup = read('src', 'ui', 'popup.ts'), main = read('desktop', 'main.cjs');
  assert.match(app_, /kind === 'update' && <UpdatePopover/); assert.match(app_, /update:'\.update-pill\[data-phase=ready\]'/);
  assert.match(validation, /'workspace-edit', 'update', 'whats-new'\]/); assert.match(popup, /if\(kind==='update'\)return \d+;/);
  assert.match(main, /request\.type==='update\.prompt'/); assert.match(main, /case 'update\.status'[^]*case 'update\.prompt'/);
  for (const file of ['UpdatePill.tsx', 'UpdatePopover.tsx', 'useUpdateReady.ts']) assert.doesNotMatch(read('src', 'features', 'updates', file), /dangerouslySetInnerHTML|innerHTML/, `${file} renders text only`);
  assert.match(read('src', 'features', 'updates', 'UpdatePill.tsx'), /preset=\{ready \? 'check' : 'progress'\}/, 'the existing dot matrix: progress fill, then the check');
  assert.doesNotMatch(read('src', 'features', 'updates', 'update-pill.css'), /<progress|scaleX\(|width:\s*var\(--/, 'no progress line');
});

test('every new update string is in all 13 catalogs with its parameters', () => {
  const need = { 'update.downloadTip': ['version'], 'update.downloadDetail': ['percent', 'done', 'total', 'speed'], 'update.downloadDetailShort': ['percent'], 'update.readyTip': ['version'], 'update.readyTipHint': [], 'update.readyTitle': [], 'update.version': ['version'], 'update.readyBody': [], 'update.readMore': [], 'update.back': [], 'update.later': [], 'update.installNow': [], 'update.installing': [] };
  const files = fs.readdirSync(path.join(root, 'src', 'i18n')).filter(name => /^[A-Za-z-]+\.json$/.test(name) && name !== 'converted.json');
  assert.equal(files.length, 13);
  for (const file of files) {
    const catalog = JSON.parse(read('src', 'i18n', file));
    for (const [id, names] of Object.entries(need)) { assert.ok(catalog[id] && catalog[id].length > 1, `${file} lacks ${id}`); for (const name of names) assert.ok(catalog[id].includes(`{${name}}`), `${file} ${id} lacks {${name}}`); }
    assert.doesNotMatch(catalog['updates.updatesComeFromGithubReleases'], /github/i, `${file}: updates no longer come from GitHub Releases`);
  }
});

test('a settled steady dot matrix leaves the shared loop (no idle frames), and a tip that changes while shown is redrawn in place', () => {
  const matrix = read('src', 'components', 'DotMatrix.tsx'), tooltip = read('src', 'components', 'transient', 'Tooltip.tsx');
  assert.match(matrix, /if \(paint\(now \/ 1000\) === true\) painters\.delete\(paint\)/); assert.match(matrix, /if \(settled && steady\(preset\)\) return true;/); assert.match(matrix, /progress: torConnecting/);
  assert.match(tooltip, /attributeFilter: \['data-tip'\]/); assert.match(tooltip, /id: refreshing \? serial : \+\+serial/);
});

// Round 6, the founder's note: the What's new pop-up opened in a random place, only after a click on the toast's button.
test('after a restart into a new version with notes: one popup, claimed once, with that version\'s plain-text notes; no notes, no popup', () => {
  const dir = folder();
  const first = make(dir, { autoUpdater: progressUpdater(u => u.emit('update-downloaded', { version: '1.1.0', releaseNotes: '<ul><li>Faster <b>tabs</b></li></ul>' })) });
  assert.equal(first.status().welcome, false, 'a fresh install has nothing to show'); assert.equal(first.status().whatsNew, null);
  return first.check().then(() => {
    const second = make(dir, { version: '1.1.0' });
    assert.equal(second.status().welcome, true); assert.deepEqual(second.status().whatsNew, { version: '1.1.0', notes: '• Faster tabs' });
    assert.equal(second.claimWelcome().claimed, true, 'the first window asks and gets it');
    assert.equal(second.status().welcome, false); assert.equal(second.claimWelcome().claimed, false, 'no second window, no second look');
    const third = make(dir, { version: '1.1.0' });
    assert.equal(third.status().welcome, false, 'the next launch does not have it'); assert.equal(third.claimWelcome().claimed, false);
    const bare = folder(); fs.writeFileSync(path.join(bare, 'updater.json'), JSON.stringify({ lastRunVersion: '1.0.0' }));
    const plain = make(bare, { version: '1.0.1' });
    assert.equal(plain.status().welcome, false, 'a new version without notes opens no empty popup'); assert.equal(plain.claimWelcome().claimed, false);
    assert.deepEqual(plain.whatsNewInfo(), { version: '1.0.1', notes: '' }, 'it is still known, for the quiet toast');
  });
});

test('the what\'s-new popup is a centred popup kind with the update popup\'s glass, shown by itself after a short calm, never a dialog window', () => {
  const popup = read('src', 'ui', 'popup.ts'), app_ = read('src', 'App.tsx'), validation = read('desktop', 'validation.cjs'), scrim = read('desktop', 'page-scrim.cjs'), pill = read('src', 'features', 'updates', 'UpdatePill.tsx'), main = read('desktop', 'main.cjs');
  assert.match(popup, /const centered=kind==='tabs'\|\|kind==='switcher'\|\|kind==='whats-new';/, 'centred by the popup system, so at any window size, scale and sidebar state');
  assert.match(popup, /kind==='whats-new'\?400:/); assert.match(popup, /if\(kind==='whats-new'\)return \d+;/);
  assert.match(validation, /'update', 'whats-new'\]/); assert.match(scrim, /'whats-new'\]\)/, 'the page dims behind it like the other centred panels');
  assert.match(app_, /kind === 'whats-new' && <WhatsNewPopover/); assert.match(app_, /onOpenNotes=\{\(\) => open\('whats-new'\)\}/);
  assert.match(pill, /!whatsNew\?\.pending \|\| !canAsk/); assert.match(pill, /claimWhatsNew\(\)\.then\(\(claimed\) => \{ if \(claimed\) openNotes\.current\(\); \}\); \}, 1200\)/);
  assert.match(main, /request\.type==='update\.prompt'\|\|request\.type==='update\.welcome'/); assert.match(main, /now\.prompt\|\|now\.welcome/);
  assert.doesNotMatch(read('src', 'features', 'updates', 'WhatsNewPopover.tsx'), /dangerouslySetInnerHTML|innerHTML|autoFocus/, 'plain text only, and it never takes the keyboard from the page');
});
