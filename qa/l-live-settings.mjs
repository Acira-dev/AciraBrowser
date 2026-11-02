// Stream L: live-setting stress. Flips the tab layout (sidebar <-> toolbar) 10 times each way through the Settings page with
// real clicks, then applies every other setting that takes effect without a restart. After every change it checks that the
// chrome still renders, no exception was thrown, tabs still switch (real clicks), the tab viewer still opens, and each native
// page view still sits exactly where the page area is (a stale view over the strip is how "I can't switch a tab" happens).
//   node qa/l-live-settings.mjs [--keep]   -> prints a table, exits 1 on any failure. Isolated profile under .qa-profiles.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

// Off-screen and not activated by default (nothing on the founder's screen, no stolen focus; it still renders, which pointer drags need); --visible puts it on screen.
const visible = process.argv.includes('--visible');
const stamp = Date.now(), data = path.resolve('.qa-profiles/l-live-' + stamp);
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!doctype html><title>Page ${req.url}</title><body style="font:16px system-ui;margin:40px"><h1>${req.url}</h1>${'<p>Some text.</p>'.repeat(30)}`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'), // Off-screen windows must keep rendering at full rate (Windows would otherwise treat them as hidden and pointer drags turn flaky).
  args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ...(visible ? {} : { ACIRA_BROWSER_TEST_HIDDEN: '1' }) }, timeout: 40000,
});
const find = async test => { for (let i = 0; i < 300; i++) { const p = app.windows().find(p => test(p.url())); if (p) return p; await new Promise(r => setTimeout(r, 100)); } throw Error('page not found'); };
const ui = await find(u => u === 'acira-browser-ui://ui/index.html');
const errors = [];
const watch = p => { p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text().slice(0, 160)); }); };
watch(ui); app.on('window', p => { if (p.url().startsWith('acira-browser-ui://')) watch(p); });
try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
await app.evaluate(({ screen, BaseWindow }, visible) => { const d = screen.getPrimaryDisplay(), w = BaseWindow.getAllWindows()[0]; /* off-screen and not activated: it still renders (pointer drags need that) but never shows or takes focus */ w.setBounds({ x: visible ? d.workArea.x + 40 : -3000, y: d.workArea.y + 20, width: 1400, height: 860 }); if (visible) w.focus(); else w.showInactive(); }, visible);
const wait = ms => new Promise(r => setTimeout(r, ms));
const snapOf = pg => pg.evaluate(() => window.acira.getSnapshot());
const actOn = (pg, action) => pg.evaluate(a => window.acira.dispatch(a), action);
const snap = () => snapOf(ui), act = action => actOn(ui, action);

let exitCode = 1;
try {
// Fixture: 14 tabs, 3 groups (one collapsed), 3 pinned, Settings open on the Tabs section.
let s = await snap();
// Hard caps, per the sprint rules: at most 30 tabs in a QA profile, every loop bounded, every open checked (abort if it did not take).
const MAX_TABS = 30;
for (let opened = 0; s.tabs.length < 13 && opened < 13; opened++) {
  const before = s.tabs.length;
  if (before >= MAX_TABS) throw Error('too many tabs: ' + before);
  await act({ type: 'tab.new', url: `${base}/page-${before}` }); await wait(200); s = await snap();
  if (s.tabs.length !== before + 1) throw Error('tab.new did not add exactly one tab (' + before + ' -> ' + s.tabs.length + '); aborting');
}
let ids = s.tabs.map(t => t.id);
for (const [g, members] of [[0, [ids[4], ids[5]]], [1, [ids[6], ids[7], ids[8]]], [2, [ids[9], ids[10]]]]) {
  await act({ type: 'tab.group.create', tabId: members[0], name: 'Group ' + g }); s = await snap();
  await act({ type: 'tab.group.assign', tabIds: members.slice(1), groupId: s.tabGroups.find(x => x.name === 'Group ' + g).id });
}
s = await snap(); await act({ type: 'tab.group.update', id: s.tabGroups.find(x => x.name === 'Group 1').id, patch: { collapsed: true } });
for (const id of ids.slice(0, 3)) await act({ type: 'tab.pin', id });
await act({ type: 'tab.new', url: 'acira://settings' }); await wait(1500);
s = await snap(); const settingsId = s.activeTabId;
const openTabsSection = async pg => { const p = await pg.evaluate(() => { const e = [...document.querySelectorAll('button,a,[role=tab]')].find(e => e.textContent.trim() === 'Tabs' && e.getBoundingClientRect().x < 220 && e.offsetParent); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]; }); if (!p) throw Error('Settings > Tabs entry not found'); await pg.mouse.click(p[0], p[1]); await wait(600); };
await openTabsSection(ui);

const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7), run = part => !only || only === part;
const flips = Math.min(Number((process.argv.find(a => a.startsWith('--flips=')) || '--flips=20').slice(8)) || 20, 20);
const rows = [];
const record = (name, problems) => { rows.push({ name, problems }); console.log((problems.length ? 'FAIL ' : 'ok   ') + name + (problems.length ? '\n       ' + problems.join('\n       ') : '')); };

/** tab.new must show up in the snapshot at once (a stale snapshot is how a script, or a person, ends up opening tab after tab). */
async function growth(pg) {
  const n0 = (await snapOf(pg)).tabs.length;
  if (n0 >= 28) return ['too many tabs for the growth check: ' + n0];
  await actOn(pg, { type: 'tab.new', url: `${base}/grow` }); await wait(400);
  const after = await snapOf(pg), added = after.tabs.find(t => t.url.endsWith('/grow')), problems = [];
  if (after.tabs.length !== n0 + 1 || !added) problems.push(`tab.new did not add a tab (${n0} -> ${after.tabs.length}): the snapshot is stale`);
  if (added) { await actOn(pg, { type: 'tab.close', id: added.id }); await wait(400); const n2 = (await snapOf(pg)).tabs.length; if (n2 !== n0) problems.push(`tab.close left ${n2} tabs, expected ${n0}`); }
  return problems;
}

/** Everything that must still be true after a live change. `settings` = stay on the Settings tab afterwards. */
async function verify(label) {
  const problems = [];
  const before = errors.length;
  await wait(700);
  if ((await snap()).tabs.length > 30) throw Error('more than 30 tabs in a QA profile: aborting');
  const alive = await ui.evaluate(() => !!document.getElementById('root')?.children.length).catch(() => false);
  if (!alive) { problems.push('chrome did not render'); return problems; }
  if (/couldn’t display this view/.test(await ui.evaluate(() => document.body.innerText).catch(() => ''))) problems.push('error screen shown');
  // Real clicks on up to four tabs, only on tabs that are really on screen (topmost at their centre). Focus mode and a hidden
  // sidebar hide the tab list by design: then only rendering, exceptions, the tab viewer and tab.new are checked.
  const now = await snap(), hiddenByDesign = now.windowUi.focusMode || (now.settings.verticalTabs && !(now.windowUi.workspaceOpen && now.windowUi.webWorkspaceOpen));
  const targets = hiddenByDesign ? [] : await ui.evaluate(settingsId => [...document.querySelectorAll('.sb-tab[data-tab-id],.tab-strip-viewport .browser-tab,.acira-compact-tabs-track [data-tab-id]')].filter(e => e.offsetParent && e.dataset.tabId !== settingsId && !e.classList.contains('selected') && e.getAttribute('aria-selected') !== 'true').map(e => { const b = e.getBoundingClientRect(), x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2); return { id: e.dataset.tabId, x, y, top: document.elementFromPoint(x, y)?.closest('[data-tab-id]')?.dataset.tabId === e.dataset.tabId }; }).filter(t => t.top).slice(0, 4), settingsId);
  if (!hiddenByDesign && targets.length < Math.min(2, now.tabs.length - 1)) problems.push('only ' + targets.length + ' clickable tabs on screen (of ' + now.tabs.length + ')');
  const layoutNote = 'strip: ' + targets.map(t => t.id.slice(4, 10) + '@' + t.x + ',' + t.y).join(' ') + ' | active before: ' + (await snap()).activeTabId.slice(4, 10);
  for (const first of targets) {
    // Measure again right before each click: the strip reflows after every selection, as a person would see it.
    // Pick a point of the tab that is really on top and is not its own close button (the active narrow tab swaps its icon for one).
    const t = await ui.evaluate(id => { const e = [...document.querySelectorAll('[data-tab-id]')].find(e => e.dataset.tabId === id && e.offsetParent); if (!e) return null; const b = e.getBoundingClientRect(), y = Math.round(b.y + b.height / 2); for (const f of [.5, .35, .65, .2, .8, .1, .9]) { const x = Math.round(b.x + b.width * f), hit = document.elementFromPoint(x, y); if (hit?.closest('[data-tab-id]')?.dataset.tabId === id && !hit.closest('[aria-label^="Close"],[title^="Close"],[class*="close"],[class*="audio"],[class*="mute"]')) return { id, x, y, top: true }; } return { id, x: Math.round(b.x + b.width / 2), y, top: false }; }, first.id);
    if (!t) { problems.push('tab ' + first.id.slice(4, 10) + ' vanished from the strip before its click'); continue; }
    if (!t.top) { problems.push('no point of tab ' + first.id.slice(4, 10) + ' can be clicked (covered or only its close button)'); continue; }
    await ui.mouse.click(t.x, t.y); await wait(500); const a = (await snap()).activeTabId; if (a !== t.id) { const at = await ui.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return (e?.closest('[data-tab-id]')?.dataset.tabId || '').slice(4, 10) + ' <' + (e?.className?.toString() || e?.tagName).slice(0, 30) + '>'; }, [t.x, t.y]); const info = (await snap()), tt = info.tabs.find(x => x.id === t.id), ta = info.tabs.find(x => x.id === a); problems.push(`click on ${t.id.slice(4, 10)} at ${t.x},${t.y} activated ${a.slice(4, 10)}; element there: ${at}; ${layoutNote}; clicked tab ${JSON.stringify(tt && { kind: tt.contentKind, pinned: tt.pinned, group: tt.group, url: tt.url?.slice(-12), loading: tt.loading, sleeping: tt.sleeping, err: tt.error })}; active tab ${JSON.stringify(ta && { kind: ta.contentKind, pinned: ta.pinned, group: ta.group, url: ta.url?.slice(-12) })}; ui ${JSON.stringify(info.windowUi)}; vertical ${info.settings.verticalTabs}`); if (!globalThis.__probed) { globalThis.__probed = true; const out = []; for (let k = 0; k < 3; k++) { await ui.mouse.click(t.x, t.y); await wait(600); out.push('re-click ' + (k + 1) + ' -> ' + (await snap()).activeTabId.slice(4, 10)); } const s0 = await snap(); out.push('ipc snapshot has tab: ' + s0.tabs.some(x => x.id === t.id) + ' (rev ' + s0.revision + ', ' + s0.tabs.length + ' tabs)'); out.push('dom tab ids: ' + await ui.evaluate(() => [...document.querySelectorAll('.tab-strip-viewport [data-tab-id]')].map(e => e.dataset.tabId.slice(4, 10)).join(','))); out.push('ipc ids: ' + s0.tabs.map(x => x.id.slice(4, 10)).join(',')); try { await act({ type: 'tab.select', id: t.id }); await wait(500); out.push('tab.select -> ' + (await snap()).activeTabId.slice(4, 10)); } catch (e) { out.push('tab.select threw: ' + String(e.message).slice(-90)); const s1 = await snap(); out.push('after throw: ipc has tab ' + s1.tabs.some(x => x.id === t.id) + ' rev ' + s1.revision); } out.push('stack at point: ' + await ui.evaluate(([x, y]) => document.elementsFromPoint(x, y).slice(0, 4).map(e => e.tagName.toLowerCase() + '.' + (e.className?.toString() || '').trim().split(/s+/).slice(0, 2).join('.')).join(' < '), [t.x, t.y])); out.push('html attrs: ' + await ui.evaluate(() => [...document.documentElement.attributes].map(a => a.name + '=' + a.value.slice(0, 20)).join(' ') + ' | body cursor ' + document.body.style.cursor + ' | strip: ' + [...(document.querySelector('.tab-strip-viewport')?.attributes || [])].map(a => a.name + '=' + a.value.slice(0, 20)).join(' '))); problems.push('probe: ' + out.join('; ')); }
      await ui.screenshot({ path: path.resolve('.qa-profiles/l-shots/live-fail-' + label.replace(/[^a-z0-9]+/gi, '-') + '.png') }).catch(() => {}); } }
  // Native page view = page area, and nothing else native is stacked over the chrome.
  const area = await ui.evaluate(() => { const b = document.querySelector('.page-area')?.getBoundingClientRect(); return b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; });
  const views = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].contentView.children.map((v, i) => ({ i, vis: v.getVisible(), b: v.getBounds(), web: !!v.webContents && !/^(acira-browser-ui|file):/.test(v.webContents.getURL()) /* the chrome renderers and the tab hover card (a file:// page) are not page views */ })).filter(v => v.i > 0 && v.vis));
  const web = views.filter(v => v.web);
  if (web.length > 1) problems.push(web.length + ' page views visible at once');
  const active = (await snap()).tabs.find(t => t.id === targets.at(-1)?.id);
  if (web[0] && area && active?.contentKind === 'web' && [web[0].b.x, web[0].b.y, web[0].b.width, web[0].b.height].some((v, i) => Math.abs(v - area[i]) > 2)) problems.push(`page view ${JSON.stringify(web[0].b)} != page area ${JSON.stringify(area)}`);
  // The tab viewer (a popup) still opens and closes.
  await ui.keyboard.press('Alt+t'); await wait(900);
  const overlay = app.windows().find(p => p.url().includes('view=overlay'));
  const open = overlay ? await overlay.evaluate(() => document.body.innerText.length > 0).catch(() => false) : false;
  if (!open) problems.push('tab viewer did not open');
  await ui.keyboard.press('Escape'); await wait(500);
  problems.push(...await growth(ui));
  if (errors.length > before) problems.push(...errors.slice(before));
  // Back to Settings for the next change.
  await act({ type: 'tab.select', id: settingsId }); await wait(500);
  return problems;
}

const flip = async (pg = ui) => {
  // The page may still be drawing (a second window is slower): look for the card up to 20 times, 300 ms apart.
  let p = null;
  for (let tries = 0; tries < 20 && !p; tries++) {
    p = await pg.evaluate(() => { const e = [...document.querySelectorAll('[role=radiogroup][aria-label="Tabs"] [role=radio]')].find(e => e.getAttribute('aria-checked') === 'false'); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
    if (!p) await wait(300);
  }
  if (!p) throw Error('Tab layout card not found on the Settings page');
  await pg.mouse.click(p[0], p[1]); await wait(900);
};

// 1. Layout flips through the Settings page, 10 each way (20 flips).
for (let i = 1; run('layout') && i <= flips; i++) {
  await flip();
  const vertical = (await snap()).settings.verticalTabs;
  const p = await verify('flip ' + i);
  if (vertical !== (i % 2 === 1)) p.push('layout is ' + (vertical ? 'sidebar' : 'toolbar') + ' but expected ' + (i % 2 === 1 ? 'sidebar' : 'toolbar'));
  record(`flip ${i}: to ${i % 2 === 1 ? 'sidebar' : 'toolbar'} tabs`, p);
}

// 1b. Settings open in a SECOND window: flip from there, then window 1's tabs and window 2's own tabs must both still work.
if (run('windows')) {
  await ui.evaluate(() => window.acira.openWindow('normal'));
  let ui2 = null;
  for (let i = 0; i < 100 && !ui2; i++) { ui2 = app.windows().find(p => p !== ui && p.url() === 'acira-browser-ui://ui/index.html') || null; if (!ui2) await wait(100); }
  if (!ui2) throw Error('second window did not open');
  await wait(2000);
  for (let i = 0; i < 2; i++) { await actOn(ui2, { type: 'tab.new', url: `${base}/w2-${i}` }); await wait(300); }
  await actOn(ui2, { type: 'tab.new', url: 'acira://settings' }); await wait(1500);
  const settings2 = (await snapOf(ui2)).activeTabId;
  await openTabsSection(ui2);
  const targetsOf = (pg, skip) => pg.evaluate(skip => [...document.querySelectorAll('.sb-tab[data-tab-id],.tab-strip-viewport .browser-tab')].filter(e => e.offsetParent && e.dataset.tabId !== skip && e.getAttribute('aria-selected') !== 'true').slice(0, 3).map(e => { const b = e.getBoundingClientRect(); return { id: e.dataset.tabId, x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; }), skip);
  for (let i = 1; i <= 6; i++) {
    const problems = [], before = errors.length, expectVertical = (await snapOf(ui2)).settings.verticalTabs === false;
    await flip(ui2); await wait(1200);
    const [v1, v2] = [(await snap()).settings.verticalTabs, (await snapOf(ui2)).settings.verticalTabs];
    if (v1 !== expectVertical || v2 !== expectVertical) problems.push(`layouts disagree: window 1 ${v1 ? 'sidebar' : 'toolbar'}, window 2 ${v2 ? 'sidebar' : 'toolbar'}, expected ${expectVertical ? 'sidebar' : 'toolbar'}`);
    for (const [name, pg, skip] of [['window 1', ui, settingsId], ['window 2', ui2, settings2]]) {
      const targets = await targetsOf(pg, skip);
      if (targets.length < 2) problems.push(name + ': only ' + targets.length + ' tabs visible');
      for (const t of targets) { await pg.mouse.click(t.x, t.y); await wait(500); const a = (await snapOf(pg)).activeTabId; if (a !== t.id) problems.push(`${name}: click on ${t.id.slice(4, 10)} activated ${a.slice(4, 10)}`); }
      problems.push(...(await growth(pg)).map(m => name + ': ' + m));
    }
    await actOn(ui2, { type: 'tab.select', id: settings2 }); await wait(500);
    if (errors.length > before) problems.push(...errors.slice(before));
    record(`window 2 flip ${i}: to ${expectVertical ? 'sidebar' : 'toolbar'} tabs (windows 1 and 2 checked)`, problems);
  }
}

// 1c. Monkey: 120 seeded random operations (tabs, groups, pins, mute, split, focus, sidebar, layout). Hard caps: 120 operations,
// 20 tabs. After each one the chrome must still render with no exception; every 10th also clicks a tab and opens the tab viewer.
if (run('monkey')) {
  let seed = 20261025; const rnd = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const log = [];
  for (let n = 1; n <= 120; n++) {
    const st = await snap(), tabs = st.tabs, pick = () => tabs[rnd(tabs.length)];
    const web = tabs.filter(t => t.contentKind === 'web');
    const ops = [
      ['tab.new', () => tabs.length < 20 && act({ type: 'tab.new', url: `${base}/m-${n}`, background: rnd(2) === 0 })],
      ['tab.close', () => tabs.length > 6 && act({ type: 'tab.close', id: pick().id })],
      ['tab.restore', () => st.closedTabs.length && tabs.length < 20 && act({ type: 'tab.restore' })],
      ['tab.pin', () => act({ type: 'tab.pin', id: pick().id })],
      ['tab.mute', () => web.length && act({ type: 'tab.mute', id: web[rnd(web.length)].id, muted: rnd(2) === 0 })],
      ['tab.duplicate', () => tabs.length < 20 && act({ type: 'tab.duplicate', id: pick().id })],
      ['tab.select', () => act({ type: 'tab.select', id: pick().id })],
      ['tab.reorder', () => { const a = pick(), b = pick(); return a.id !== b.id && act({ type: 'tab.reorder', from: a.id, to: b.id }); }],
      ['group.create', () => { const t = pick(); return !t.group && act({ type: 'tab.group.create', tabId: t.id, name: 'G' + n }); }],
      ['group.assign', () => st.tabGroups.length && act({ type: 'tab.group.assign', tabIds: [pick().id], groupId: st.tabGroups[rnd(st.tabGroups.length)].id })],
      ['group.ungroup', () => act({ type: 'tab.group.assign', tabIds: [pick().id], groupId: null })],
      ['group.collapse', () => st.tabGroups.length && (g => act({ type: 'tab.group.update', id: g.id, patch: { collapsed: !g.collapsed } }))(st.tabGroups[rnd(st.tabGroups.length)])],
      ['group.remove', () => st.tabGroups.length > 2 && act({ type: 'tab.group.remove', id: st.tabGroups[rnd(st.tabGroups.length)].id })],
      ['split.open', () => web.length > 1 && !st.windowUi.split && act({ type: 'split.open', tabIds: [web[0].id, web[1].id] })],
      ['split.close', () => st.windowUi.split && act({ type: 'split.close' })],
      ['layout', () => act({ type: 'settings.update', patch: { verticalTabs: !st.settings.verticalTabs } })],
      ['layout', () => act({ type: 'settings.update', patch: { verticalTabs: !st.settings.verticalTabs } })],
      ['focus', () => act({ type: 'ui.update', patch: { focusMode: !st.windowUi.focusMode } })],
      ['sidebar', () => act({ type: 'ui.update', patch: { workspaceOpen: !st.windowUi.workspaceOpen, webWorkspaceOpen: !st.windowUi.webWorkspaceOpen } })],
    ];
    const [name, op] = ops[rnd(ops.length)], before = errors.length;
    let threw = '';
    try { await op(); } catch (e) { threw = String(e.message || e).slice(0, 140); }
    await wait(250);
    log.push(name);
    const alive = await ui.evaluate(() => !!document.getElementById('root')?.children.length && !/couldn’t display this view/.test(document.body.innerText)).catch(() => false);
    const after = await snap().catch(() => null);
    const problems = [];
    if (threw && !/Invalid browser action|outside this profile/.test(threw)) problems.push('dispatch threw: ' + threw);
    if (!alive || !after) problems.push('chrome stopped rendering');
    if (after && after.tabs.length > 30) throw Error('more than 30 tabs: aborting');
    if (errors.length > before) problems.push(...errors.slice(before));
    if (!problems.length && n % 10 === 0) problems.push(...await verify('monkey ' + n));
    if (problems.length) { record(`monkey op ${n} (${name}) after ${log.slice(-8).join(' > ')}`, problems); if (!alive) break; }
  }
  if (!rows.some(r => r.name.startsWith('monkey'))) record('monkey: 120 random operations, no exception, chrome alive', []);
}

// 2. Every other live setting, both ways where it has two states.
const sets = (name, ...patches) => ({ name, run: async () => { for (const patch of patches) { await act({ type: 'settings.update', patch }); await wait(500); } } });
const ui_ = (name, ...patches) => ({ name, run: async () => { for (const patch of patches) { await act({ type: 'ui.update', patch }); await wait(500); } } });
const switches = [
  sets('appearance dark / light / auto', { appearance: 'dark' }, { appearance: 'light' }, { appearance: 'system' }),
  sets('interface scale 125% / 100%', { interfaceScale: 125 }, { interfaceScale: 100 }),
  sets('reduced motion on / off', { reducedMotion: true }, { reducedMotion: false }),
  sets('reduced transparency on / off', { reducedTransparency: true }, { reducedTransparency: false }),
  sets('compact tab titles off / on', { compactTabTitles: false }, { compactTabTitles: true }),
  sets('toolbar layout automatic / expanded', { toolbarLayout: 'automatic' }, { toolbarLayout: 'expanded' }),
  sets('bookmarks bar on / off', { bookmarksBar: true, bookmarksOnNewTabOnly: false }, { bookmarksBar: false }),
  sets('sidebar width 320 / 240', { sidebarWidth: 320 }, { sidebarWidth: 240 }),
  sets('search engine bing / duckduckgo / google', { searchEngine: 'bing' }, { searchEngine: 'duckduckgo' }, { searchEngine: 'google' }),
  sets('address suggestions off / on', { addressSuggestions: false }, { addressSuggestions: true }),
  sets('content blocking off / on', { blocking: false }, { blocking: true }),
  sets('memory saver off / on', { memorySaver: { enabled: false, idleMinutes: 15, neverSleep: [] } }, { memorySaver: { enabled: true, idleMinutes: 15, neverSleep: [] } }),
  ui_('sidebar hidden / shown', { workspaceOpen: false, webWorkspaceOpen: false }, { workspaceOpen: true, webWorkspaceOpen: true }),
  ui_('focus mode on / off', { focusMode: true }, { focusMode: false }),
];
for (const layout of run('settings') ? [true, false] : []) {
  await act({ type: 'settings.update', patch: { verticalTabs: layout } }); await wait(800);
  for (const sw of switches) {
    try { await sw.run(); } catch (e) { record(`[${layout ? 'sidebar' : 'toolbar'}] ${sw.name}`, ['threw: ' + e.message]); continue; }
    record(`[${layout ? 'sidebar' : 'toolbar'}] ${sw.name}`, await verify(sw.name));
  }
}
// Finishes (glass colours) and the profile switch.
s = await snap();
const finishes = !run('settings') ? [] : Object.keys(s.settings.stylePreferences || {});
for (const style of finishes) { await act({ type: 'settings.update', patch: { style } }); await wait(600); }
if (run('settings')) record('style: ' + (finishes.join(', ') || 'none') + ' cycled', await verify('style'));
const profiles = s.browserProfiles.filter(p => !p.private);
if (run('profile') && profiles.length < 2) { await act({ type: 'browser.profile.create', name: 'Work' }); await wait(800); s = await snap(); }
if (run('profile')) {
  for (const p of s.browserProfiles.filter(p => !p.private)) {
    const windowsBefore = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length);
    await act({ type: 'browser.profile.select', id: p.id }); await wait(2000);
    console.log('       select ' + p.name + ': windows ' + windowsBefore + ' -> ' + await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length) + ', tabs ' + (await snap()).tabs.length + ', active ' + (await snap()).activeTabId.slice(4, 10));
  }
  record('profile switch (windows follow)', await verify('profile'));
}

const failed = rows.filter(r => r.problems.length);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
exitCode = failed.length ? 1 : 0;
} finally {
  // One Electron instance, always closed, whatever happened above.
  await Promise.race([app.close(), new Promise(r => setTimeout(r, 8000))]).catch(() => {});
  try { app.process().kill(); } catch {}
  server.close();
  if (!process.argv.includes('--keep')) await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
