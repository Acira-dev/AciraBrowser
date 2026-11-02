// Real app: the split header menu moves keyboard focus into a section it opens (Change layout, Move to tab group) and back to the row that
// opened it on ArrowLeft / Escape, like the tab group menu. Native key events (webContents.sendInputEvent) into the menu's overlay, one Electron,
// isolated profile, off-screen and not focusable, no real mouse. Also a clip scan of the menu with a section open (the focus ring is on its first row)
// in light/dark x 100/150% x English/German.   node qa/split-menu-focus.mjs [--shots dir]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const shots = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };
const root = path.resolve(`.qa-profiles/split-menu-focus-${Date.now()}`);
const scan = await fs.readFile('qa/m-clip-scan.js', 'utf8');
await withSlot('split-menu-focus', async () => {
  const site = await httpFixture((req, res) => { const n = req.url.replace(/\W/g, '') || 'root'; res.writeHead(200, {'content-type': 'text/html'}); res.end(`<!doctype html><title>${n.toUpperCase()} page</title><p>${n}`); });
  const base = `http://127.0.0.1:${site.port}`;
  const t = await startApp({root, skipSetup: true});
  try {
    await t.ui.locator('.setup-dialog').waitFor({state: 'hidden', timeout: 5000}).catch(() => {});
    await t.main(({BaseWindow}) => { for (const w of BaseWindow.getAllWindows()) { w.setFocusable(false); w.setIgnoreMouseEvents(true); } const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: -20000, y: -20000, width: 1280, height: 900}); w.showInactive(); });
    await t.act({type: 'settings.update', patch: {onboardingComplete: true, language: 'en', appearance: 'light', interfaceScale: 100, verticalTabs: true}});
    for (const n of ['a', 'b', 'c', 'd']) await t.act({type: 'tab.new', url: `${base}/${n}`, background: true});
    await poll(async () => (await t.state()).tabs.length === 5, Boolean, 'tabs');
    const idOf = async n => (await t.state()).tabs.find(tab => tab.url === `${base}/${n}`).id;
    const [a, b, c, d] = [await idOf('a'), await idOf('b'), await idOf('c'), await idOf('d')];
    await t.act({type: 'tab.group.create', tabId: c, name: 'Research', color: 'purple'});
    await t.act({type: 'tab.select', id: a});
    await t.act({type: 'split.open', tabIds: [a, b]});
    await poll(async () => (await t.state()).windowUi.split?.tabIds.length === 2, Boolean, 'split');
    const overlay = () => t.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
    const layout = () => t.ui.evaluate(() => window.acira.getBrowserLayout());
    /** Native key events into the menu's overlay view. */
    const press = key => t.main(({BaseWindow}, key) => {
      const collect = node => [node, ...(node.children || []).flatMap(collect)], views = collect(BaseWindow.getAllWindows()[0].contentView);
      const view = views.find(v => v.webContents?.getURL?.().includes('view=overlay')); if (!view) throw Error('no overlay view');
      view.webContents.focus();
      const code = {ArrowLeft: 'Left', ArrowRight: 'Right'}[key] || key; // Electron's key names
      view.webContents.sendInputEvent({type: 'keyDown', keyCode: code});
      if (key === 'Enter') view.webContents.sendInputEvent({type: 'char', keyCode: '\r'});
      view.webContents.sendInputEvent({type: 'keyUp', keyCode: code});
    }, key);
    const inspect = () => overlay().evaluate(() => {
      const menu = document.querySelector('.tab-group-controls'); if (!menu) return {label: null, count: 0, active: -1, activeText: null, activeSub: null, closed: true}; const rows = [...menu.querySelectorAll('[role=menuitem]')], active = rows.indexOf(document.activeElement);
      return {label: menu.getAttribute('aria-label'), count: rows.length, active, activeText: rows[active]?.textContent?.trim() ?? null, activeSub: rows[active]?.getAttribute('aria-haspopup') ?? null};
    });
    const openMenu = async () => {
      await t.cmd({type: 'ui', tabId: a, action: 'open', kind: 'split-context', targetTabId: a, anchor: {x: 400, y: 60, width: 2, height: 2}});
      await poll(async () => (await layout())?.overlay?.kind === 'split-context', Boolean, 'split-context', 8000); await sleep(500);
      await poll(overlay, Boolean, 'overlay page', 8000);
      // Off-screen WebContentsViews retain stale Blink paint after native resize.
      // Reload only this owned overlay before measuring the settled scene.
      await overlay().reload();
      await poll(() => overlay()?.evaluate(() => document.querySelectorAll('.tab-group-controls [role=menuitem]').length).catch(() => 0), count => count > 0, 'menu rows', 8000); await sleep(300);
    };
    const closeMenu = async () => { await t.ui.evaluate(()=>window.acira.closeOverlay()); await poll(async()=>!(await layout())?.overlay,Boolean,'popup closed'); await sleep(350); };
    const focusRow = index => overlay().evaluate(index => { const row = [...document.querySelectorAll('.tab-group-controls [role=menuitem][aria-haspopup=menu]')][index]; row.focus(); return row.textContent.trim(); }, index);
    const sub = ['Change layout', 'Move to tab group'];

    // --- keyboard behaviour (English, light, 100%) ----------------------------------------------------------------------------------
    await openMenu();
    for (const [index, how, leave] of [[0, 'Enter', 'ArrowLeft'], [1, 'ArrowRight', 'ArrowLeft'], [0, 'Enter', 'Enter'], [1, 'Enter', 'Enter']]) {
      const row = await focusRow(index), home = await inspect();
      check(home.activeText === row && home.activeSub === 'menu', `"${row}" has focus on the main menu (${home.label})`);
      await press(how);
      const inside = await poll(inspect,x=>x.label!==home.label&&x.active===0,'section receives keyboard focus');
      check(inside.label !== home.label && inside.active === 0, `${how} on "${row}": the section opened (${inside.label}) and focus is on its first row (index ${inside.active}: "${inside.activeText}")`);
      if (shots && index === 0 && how === 'Enter') { await fs.mkdir(shots, {recursive: true}); await overlay().screenshot({path: path.join(shots, 'section-open.png')}).catch(() => {}); }
      if (process.env.QA_DEBUG) await overlay().evaluate(() => { window.__keys = []; for (const type of ['keydown', 'keyup', 'blur']) window.addEventListener(type, e => window.__keys.push([type, e.key, e.target?.tagName, e.defaultPrevented]), true); });
      await press(leave); await sleep(450);
      if (process.env.QA_DEBUG) console.log('keys', JSON.stringify(await overlay().evaluate(() => window.__keys).catch(error => 'gone ' + error.message)));
      const back = await poll(inspect,x=>x.label===home.label&&x.activeText===row,'focus returns to opening row');
      check(back.label === home.label && back.activeText === row && back.activeSub === 'menu', `${leave}${leave === 'Enter' ? ' on the back row' : ''}: back on the main menu with focus on the row that opened it ("${back.activeText}")`);
    }
    // (Escape is not exercised: with a popup open, main closes it natively before the page sees the key, for every popup menu, the tab group menu included.)
    await closeMenu();

    // --- clip scan with a section open and its first row focused: light/dark x 100/150% x English/German -------------------------------
    for (const [appearance, scale, language] of [['light', 100, 'en'], ['dark', 100, 'en'], ['light', 150, 'en'], ['dark', 150, 'en'], ['light', 100, 'de'], ['dark', 100, 'de'], ['light', 150, 'de'], ['dark', 150, 'de']]) {
      await t.act({type: 'settings.update', patch: {appearance, interfaceScale: scale, language}}); await sleep(900);
      for (const index of [0, 1]) {
        await openMenu(); await focusRow(index); const home = await inspect();
        await press('Enter'); await sleep(450);
        const inside = await poll(inspect,x=>x.label!==home.label&&x.active===0,'section receives keyboard focus'), text = String(await overlay().evaluate(scan)), hits = text.split('\n').filter(line => line && !/^ellipsis\(deliberate\)=\d+$/.test(line) && line !== 'no hits' && !/live region|width 1px| cw=1 /i.test(line));
        check(inside.label !== home.label && inside.active === 0 && hits.length === 0, `${appearance} ${scale}% ${language} section ${index}: focus on first row (${inside.active}), clip scan ${hits.length} hits${hits.length ? ' (' + hits.slice(0, 2).join('; ') + ')' : ''}`);
        if (shots && scale === 150 && language === 'de') await overlay().screenshot({path: path.join(shots, `section-${appearance}-${scale}-${language}-${index}.png`)}).catch(() => {});
        await press('ArrowLeft'); await sleep(350);
        const back = await poll(inspect,x=>x.label===home.label&&x.activeText===home.activeText,'focus returns to opening row'); check(back.label === home.label && back.activeText === home.activeText, `${appearance} ${scale}% ${language}: ArrowLeft returns to "${back.activeText}"`);
        await closeMenu();
      }
    }
  } finally { await t.close(); await site.close(); }
});
