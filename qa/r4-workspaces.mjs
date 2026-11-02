// R4-48 Workspaces UX, real app with real clicks: one workspace shows no switcher; create from the profile panel and the
// command bar; the title line, the switcher popover; Alt+N with the sidebar closed shows the HUD pill; move a tab from the
// tab menu; delete with the in-place confirm + Undo. Screenshots dark + light, 100% + 150%.
// Usage: node qa/r4-workspaces.mjs <outdir>   (one native slot, C:\ae\slot-N.lock; one instance; bounded waits)
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const out = path.resolve(process.argv[2] || 'C:/ae/r4/workspaces/evidence'); await fs.mkdir(out, {recursive: true});
const results = [], ok = (name, pass, detail = '') => { results.push({name, pass: !!pass, detail}); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
let slot;
for (let attempt = 0; attempt < 40 && !slot; attempt++) {
  for (const n of [1, 2, 3]) { try { const file = `C:/ae/slot-${n}.lock`; fss.writeFileSync(file, `workspaces ${new Date().toISOString()}`, {flag: 'wx'}); slot = file; break; } catch {} }
  if (!slot) await sleep(30000);
}
if (!slot) throw new Error('no native slot');
let app;
try {
  const dir = '.qa-profiles/r4-ws'; await fs.rm(dir, {recursive: true, force: true});
  app = await startApp({root: dir, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
  const key = (keyCode, modifiers = []) => app.main(({webContents}, {keyCode, modifiers}) => { const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); for (const type of ['keyDown', 'keyUp']) ui.sendInputEvent({type, keyCode, modifiers}); }, {keyCode, modifiers});
  // Real pixels of the page's own view (capturePage): a Playwright screenshot at 150% crops to the CSS viewport at device scale.
  const shot = async (page, name) => { try { const url = page.url(); const png = await app.main(async ({webContents}, url) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === url); return (await wc.capturePage()).toPNG().toString('base64'); }, url); await fs.writeFile(path.join(out, name), Buffer.from(png, 'base64')); } catch (error) { console.log('shot failed', name, error.message); } };
  const popup = async (selector, label) => { await poll(async () => { const o = overlay(); return o && await o.locator(selector).count().catch(() => 0); }, Boolean, label, 6000); await sleep(450); return overlay(); };
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 40, y: 30, width: 1280, height: 820}); w.show(); });
  await app.act({type: 'settings.update', patch: {verticalTabs: true, appearance: 'dark', interfaceScale: 100}}); await sleep(1200);
  const count = sel => app.ui.locator(sel).count();

  // 1. One workspace: no row, no title line, no chip, no tip.
  ok('one workspace shows no switcher', (await count('[data-workspace-switcher]')) + (await count('[data-workspace-title]')) + (await count('[data-workspace-chip]')) + (await count('.sb-ws-hint')) === 0);
  await shot(app.ui, '01-one-workspace-dark-100.png');

  // 2. Create from the profile panel (real clicks): profile footer -> Workspaces -> New workspace… -> type -> Enter.
  await app.ui.locator('.sb-foot-profile').first().click(); let o = await popup('[data-profile-workspace-new]', 'profile panel');
  ok('profile panel lists Workspaces', await o.locator('.ws-menu-head').count() === 1);
  await shot(o, '02-profile-panel-dark-100.png');
  await o.locator('[data-profile-workspace-new]').click(); o = await popup('#ws-edit-name', 'editor');
  await o.locator('#ws-edit-name').fill('Work'); await sleep(300);
  const iconBag = await o.locator('[data-grid=icon] [aria-checked=true]').evaluate(el => el.innerHTML.includes('ShoppingBag') || el.outerHTML.length).catch(() => null);
  await shot(o, '03-create-sheet-dark-100.png');
  ok('create sheet speaks in outcomes', /A new tab/.test(await o.locator('.acira-seg').innerText()) && /stays? in Main/.test(await o.locator('.ws-edit-note').innerText()), await o.locator('.ws-edit-note').innerText());
  await o.locator('.ws-edit button[type=submit]').click(); await sleep(900);
  let s = await app.state();
  ok('created Work from the profile panel', s.workspaces.length === 2 && s.toast?.i18n?.id === 'workspaces.created', `${s.toast?.text} icon=${s.workspaces[1]?.icon} ${iconBag}`);
  await shot(app.ui, '04-created-toast-dark-100.png');
  ok('two workspaces: row and title line show', (await count('[data-workspace-switcher]')) === 1 && (await count('[data-workspace-title]')) === 1);

  // 3. Title line -> switcher popover.
  await app.ui.locator('.sb-ws-title-main').click(); o = await popup('.ws-menu-head', 'switcher popover');
  ok('popover shows scope + counts', /same sign-ins/.test(await o.locator('.ws-menu-head').innerText()) && /tab/.test(await o.locator('.acira-menu-sub').nth(1).innerText()));
  await shot(o, '05-switcher-popover-dark-100.png');
  // Choose Main in the popover (a real click).
  await o.locator('[role=menuitemradio]').first().click(); await sleep(700);
  s = await app.state(); ok('switch via popover', s.activeWorkspaceId === s.workspaces[0].id);

  // 4. Create from the command bar.
  await app.cmd({type: 'ui', tabId: s.activeTabId, action: 'open', kind: 'palette'}); o = await popup('input', 'palette');
  await o.locator('input').first().fill('new workspace'); await sleep(400); await o.locator('input').first().press('Enter');
  o = await popup('#ws-edit-name', 'editor from palette'); await o.locator('#ws-edit-name').fill('Study'); await o.locator('#ws-edit-name').press('Enter'); await sleep(900);
  s = await app.state(); ok('created Study from the command bar', s.workspaces.length === 3 && s.workspaces[2].icon === 'book', `icon=${s.workspaces[2]?.icon}`);

  // 5. Switch with the sidebar row (click), then Alt+1 with the sidebar closed -> HUD pill.
  await app.ui.locator('[data-ws]').nth(1).click(); await sleep(600); s = await app.state(); ok('switch via sidebar icon', s.activeWorkspaceId === s.workspaces[1].id);
  await shot(app.ui, '06-row-title-dark-100.png');
  await key('E', ['control', 'shift']); await sleep(900);
  await key('1', ['alt']); await sleep(250);
  const pill = await poll(async () => { for (const p of [app.ui, overlay()].filter(Boolean)) { const t = await p.locator('.t-pill').innerText().catch(() => ''); if (t) return {t, p}; } }, Boolean, 'hud', 3000).catch(() => null);
  ok('Alt+1 with the sidebar closed shows the HUD', pill && /Main workspace/.test(pill.t), pill?.t || '');
  if (pill) await shot(pill.p, '07-hud-dark-100.png');
  s = await app.state(); ok('Alt+1 switched to Main', s.activeWorkspaceId === s.workspaces[0].id);
  await key('E', ['control', 'shift']); await sleep(900);

  // 6. Move a tab via the tab menu: Main has a tab; open its menu, Move to workspace › Work.
  const before = (await app.state()).activeTabId;
  await app.ui.locator(`.sb-tab[data-tab-id="${before}"]`).first().click({button: 'right'}).catch(error => console.log('right-click', error.message));
  o = await popup('.tab-group-controls', 'tab menu').catch(() => null);
  if (!o) console.log('tab rows', await count('.sb-tab'), await app.ui.locator('[data-tab-id]').count());
  if (o) {
    await o.getByRole('menuitem', {name: 'Move to workspace'}).click(); await sleep(300);
    await shot(o, '08-move-to-menu-dark-100.png');
    await o.getByRole('menuitem', {name: 'Work', exact: true}).click(); await sleep(700);
    s = await app.state(); ok('moved a tab to Work', s.toast?.i18n?.id === 'runtime.workspaceMoved', s.toast?.text);
  } else ok('moved a tab to Work', false, 'tab menu did not open');

  // 7. Delete Work (it now has a page? it holds tabs): right-click its icon -> Delete -> confirm -> Undo.
  s = await app.state();
  const work = s.workspaces.find(w => w.name === 'Work');
  await app.act({type: 'workspace.select', id: work.id}); await sleep(500);
  await app.act({type: 'tab.new', url: 'acira://history'}); await sleep(800);
  await app.ui.locator(`[data-ws="${work.id}"]`).click({button: 'right'}); o = await popup('.acira-menu-row-danger', 'context menu');
  await o.locator('.acira-menu-row-danger').click(); await sleep(300);
  const confirming = await o.locator('.ws-menu-confirm').count();
  ok('delete asks once in place when Work has pages', confirming === 1, confirming ? await o.locator('.ws-menu-confirm p').innerText() : '');
  await shot(o, '09-delete-confirm-dark-100.png');
  if (confirming) await o.locator('.ws-menu-confirm .acira-button-danger').click();
  await sleep(700); s = await app.state(); ok('Work deleted with Undo', !s.workspaces.some(w => w.id === work.id) && s.toast?.action?.command?.type === 'workspace.restore');
  await app.act(s.toast.action.command); await sleep(700); s = await app.state(); ok('Undo restores Work', s.workspaces.some(w => w.id === work.id));

  // 8. Looks: two+ workspaces, dark/light × 100/150.
  for (const appearance of ['dark', 'light']) for (const scale of [100, 150]) {
    await app.act({type: 'settings.update', patch: {appearance, interfaceScale: scale}}); await sleep(1500);
    await shot(app.ui, `10-sidebar-${appearance}-${scale}.png`);
    await app.ui.locator('.sb-ws-title-main').click(); o = await popup('.ws-menu-head', 'popover').catch(() => null); if (o) { await shot(o, `11-popover-${appearance}-${scale}.png`); await o.keyboard.press('Escape'); await sleep(400); }
    await app.ui.locator('.sb-foot-profile').first().click(); o = await popup('[data-profile-workspace-new]', 'profile').catch(() => null); if (o) { await shot(o, `12-profile-${appearance}-${scale}.png`); await o.keyboard.press('Escape'); await sleep(400); }
    await app.ui.locator('[data-workspace-new]').click(); o = await popup('#ws-edit-name', 'sheet').catch(() => null); if (o) { await shot(o, `13-sheet-${appearance}-${scale}.png`); await o.keyboard.press('Escape'); await sleep(400); }
  }
  // Strip layout: the chip shows with two or more.
  await app.act({type: 'settings.update', patch: {verticalTabs: false, appearance: 'dark', interfaceScale: 100}}); await sleep(1500);
  ok('strip chip shows with 3 workspaces', (await count('[data-workspace-chip]')) === 1); await shot(app.ui, '14-strip-chip-dark-100.png');
} catch (error) {
  ok('run', false, error.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  try { await app?.close(); } catch {}
  try { fss.unlinkSync(slot); } catch {}
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
}
