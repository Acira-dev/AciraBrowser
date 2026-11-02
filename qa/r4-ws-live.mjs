// R4-48 follow-up, real app: (1) a synthetic Arc profile (LOCALAPPDATA points at this run's fixture folder, never a real
// browser) imported from Settings › Import & export with real clicks: Spaces arrive as workspaces with their pinned tabs and
// a folder as a group; (2) the switch HUD in Seamless and in Focus with a real Alt+N, and with the speed setting Off (no
// rise, text read the same). Run inside a native slot (with-slot wrapper).   node qa/r4-ws-live.mjs <outdir>
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const out = path.resolve(process.argv[2] || 'C:/ae/r4/workspaces/evidence/live'); await fs.mkdir(out, {recursive: true});
const results = [], ok = (name, pass, detail = '') => { results.push({name, pass: !!pass, detail}); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const dir = path.resolve('.qa-profiles/r4-ws-live');
await fs.rm(dir, {recursive: true, force: true});

// The synthetic Arc profile: three Spaces (Work with an emoji, a blue theme, two pinned tabs and a folder; Personal; Study).
const arcRoot = path.join(dir, 'fixture-local/Packages/TheBrowserCompany.Arc_ttt1ap7aakyb4/LocalCache/Local/Arc'), userData = path.join(arcRoot, 'User Data');
await fs.mkdir(path.join(userData, 'Default'), {recursive: true});
await fs.writeFile(path.join(userData, 'Local State'), JSON.stringify({profile: {info_cache: {Default: {name: 'Arc fixture'}}}}));
const items = [], tab = (id, url, title) => items.push(id, {id, title: null, createdAt: 760000000, childrenIds: [], data: {tab: {savedURL: url, savedTitle: title}}});
const container = (id, children) => items.push(id, {id, childrenIds: children, data: {itemContainer: {containerType: {}}}});
const folder = (id, title, children) => items.push(id, {id, title, childrenIds: children, data: {list: {}}});
container('fav', ['f1']); tab('f1', 'https://mail.example.com/', 'Mail');
container('pw', ['w1', 'w2', 'wf']); tab('w1', 'https://linear.example.com/team', 'Linear'); tab('w2', 'https://docs.example.com/roadmap', 'Roadmap');
folder('wf', 'Design reviews', ['w3', 'w4']); tab('w3', 'https://figma.example.com/file/1', 'Review 1'); tab('w4', 'https://figma.example.com/file/2', 'Review 2');
container('pp', ['p1']); tab('p1', 'https://news.example.net/', 'News');
container('ps', ['s1', 's2']); tab('s1', 'https://course.example.edu/', 'Course'); tab('s2', 'https://notes.example.org/', 'Notes');
const theme = {background: {single: {_0: {style: {color: {_0: {blendedSingleColor: {_0: {color: {red: 0.2, green: 0.42, blue: 0.95, alpha: 1}}}}}}}}}};
const spaces = [
  'work', {id: 'work', title: 'Work', profile: {default: true}, containerIDs: ['pinned', 'pw'], customInfo: {iconType: {emoji_v2: '💼'}, windowTheme: theme}},
  'home', {id: 'home', title: 'Personal', profile: {default: true}, containerIDs: ['pinned', 'pp']},
  'study', {id: 'study', title: 'Study', profile: {default: true}, containerIDs: ['pinned', 'ps'], customInfo: {iconType: {emoji_v2: '📚'}}},
];
await fs.writeFile(path.join(arcRoot, 'StorableSidebar.json'), JSON.stringify({sidebar: {containers: [{global: {}}, {items, spaces, topAppsContainerIDs: [{default: true}, 'fav']}]}}));

let app;
try {
  app = await startApp({root: dir, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
  const key = (keyCode, modifiers = []) => app.main(({webContents}, {keyCode, modifiers}) => { const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); for (const type of ['keyDown', 'keyUp']) ui.sendInputEvent({type, keyCode, modifiers}); }, {keyCode, modifiers});
  // Real pixels of the page's own view (capturePage), so 150% and overlays are never cropped.
  const shot = async (page, name) => { try { const url = page.url(); const png = await app.main(async ({webContents}, url) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === url); return (await wc.capturePage()).toPNG().toString('base64'); }, url); await fs.writeFile(path.join(out, name), Buffer.from(png, 'base64')); } catch (error) { console.log('shot failed', name, error.message); } };
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 40, y: 30, width: 1280, height: 820}); w.show(); });
  await app.act({type: 'settings.update', patch: {verticalTabs: true, appearance: 'dark', interfaceScale: 100}}); await sleep(1000);

  // 1. Settings › Import & export › the Arc source › Import selected data (real clicks).
  await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1500);
  await app.ui.getByRole('button', {name: 'Import & export', exact: true}).click(); await sleep(1200);
  const source = app.ui.locator('.aip-source', {hasText: 'Arc'}).first();
  await source.click({timeout: 8000}); await sleep(1000);
  const categories = await app.ui.locator('.aip-category').allTextContents();
  ok('Arc offers Spaces as workspaces', categories.some(text => /Spaces as workspaces/.test(text)), categories.join(' | ').slice(0, 300));
  await shot(app.ui, '20-arc-import-categories-dark.png');
  await app.ui.getByRole('button', {name: 'Import selected data'}).click(); await sleep(2500);
  await shot(app.ui, '21-arc-import-receipt-dark.png');
  let s = await app.state();
  const own = s.workspaces.filter(w => w.browserProfileId === s.activeBrowserProfileId);
  ok('three Spaces became workspaces after Main', own.map(w => w.name).join(',') === ',Work,Personal,Study', own.map(w => `${w.name || 'Main'}:${w.icon ?? ''}:${w.color ?? ''}`).join(' '));
  const work = own.find(w => w.name === 'Work');
  const workTabs = s.tabs.filter(t => t.workspaceId === work?.id);
  ok('Work keeps its pinned tabs and the folder as a group', workTabs.filter(t => t.pinned).map(t => t.title).join(',') === 'Linear,Roadmap' && workTabs.filter(t => t.group === 'Design reviews').length === 2, workTabs.map(t => `${t.title}${t.pinned ? '*' : ''}${t.group ? '[' + t.group + ']' : ''}`).join(' '));
  ok('Work wears its emoji and the Arc colour', work?.icon === '💼' && work?.color === '#0088ff');
  // Open Work from the sidebar row (real click) and capture its pinned tabs and group.
  await app.ui.locator(`[data-ws="${work.id}"]`).click(); await sleep(1200);
  s = await app.state(); ok('Work opens from the row', s.activeWorkspaceId === work.id);
  await shot(app.ui, '22-arc-work-workspace-dark.png');
  await app.act({type: 'settings.update', patch: {appearance: 'light'}}); await sleep(1200);
  await shot(app.ui, '23-arc-work-workspace-light.png');
  await app.act({type: 'settings.update', patch: {appearance: 'dark'}}); await sleep(800);

  // 2. The HUD with no switcher on screen: Seamless, then Focus, with a real Alt+N.
  const hud = async (label, expect) => {
    const pill = await poll(async () => { for (const p of app.context.pages()) { const t = await p.locator('.t-pill').first().innerText({timeout: 200}).catch(() => ''); if (t) return {t, p}; } }, Boolean, 'hud', 3000).catch(() => null);
    const said = await app.ui.locator('[data-workspace-announcer]').innerText().catch(() => '');
    const live = await app.ui.evaluate(() => [...document.querySelectorAll('.sr-only[aria-live]')].map(n => n.textContent).filter(Boolean).join(' | '));
    ok(`${label}: HUD or announcement`, pill ? expect.test(pill.t) : expect.test(said), `pill="${pill?.t ?? ''}" announcer="${said}" live="${live}"`);
    if (pill) await shot(pill.p, `24-hud-${label}.png`);
    return pill;
  };
  for (const view of ['seamless', 'focus']) {
    await app.act({type: 'ui.update', patch: {view}}); await sleep(1500);
    const visible = await app.ui.evaluate(() => [...document.querySelectorAll('[data-workspace-switcher],[data-workspace-title],[data-workspace-chip]')].some(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > 0 && b.left < innerWidth && el.checkVisibility({opacityProperty: true, visibilityProperty: true}); }));
    console.log(view, 'switcher on screen:', visible);
    await key('1', ['alt']); await sleep(200);
    await hud(`${view}-alt1`, /Main workspace, 2 tabs/); // Main holds Settings and a new tab
    s = await app.state(); ok(`${view}: Alt+1 switched to Main`, s.activeWorkspaceId === own[0].id);
    await sleep(1800);
    await key('4', ['alt']); await sleep(200);
    await hud(`${view}-alt4`, /Study workspace, 2 tabs/);
    await sleep(1800);
  }

  // 3. Speed Off (reduced motion): the pill arrives without a rise and reads the same.
  await app.act({type: 'settings.update', patch: {reducedMotion: true}}); await sleep(800);
  await key('2', ['alt']);
  const frames = [];
  for (let i = 0; i < 12; i++) { frames.push(await app.ui.evaluate(() => { const p = document.querySelector('.t-pill'); return p ? getComputedStyle(p).transform + ' o=' + getComputedStyle(p).opacity : null; }).catch(() => null)); await sleep(16); }
  const pill = await hud('speed-off-alt2', /Work workspace, 4 tabs/);
  const moved = frames.filter(Boolean).some(f => !/^(none|matrix\(1, 0, 0, 1, 0, 0\))/.test(f));
  ok('speed Off: no rise (transform stays still)', !moved, frames.filter(Boolean).slice(0, 4).join(' ; ') || (pill ? 'pill in overlay' : 'no frames'));
  await app.act({type: 'settings.update', patch: {reducedMotion: false}}); await app.act({type: 'ui.update', patch: {view: 'full'}});
} catch (error) {
  ok('run', false, (error.stack || String(error)).split('\n').slice(0, 3).join(' | '));
} finally {
  try { await app?.close(); } catch {}
  await fs.writeFile(path.join(out, 'live.json'), JSON.stringify(results, null, 1));
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
}
