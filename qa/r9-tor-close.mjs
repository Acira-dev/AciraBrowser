// P0 (28 Oct): the × on the CURRENT Tor tab must close it, like any tab. Drives the real app (one instance, ≤6 tabs, closed in
// finally, slot held) in the sidebar, the horizontal strip and the compact strip: for the current and a background Tor tab it
// hovers the row and asks the page what is under the ×'s centre (a decoration painted over the × eats the click — CDP clicks
// can't show that, they land on whatever is on top), then closes with a real click, middle-click and Ctrl+W (sent as native
// input, like a key press). Prints PASS/FAIL per case.   node qa/r9-tor-close.mjs [--page]   (--page loads a site over Tor)
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const withPage = process.argv.includes('--page');
const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const LAYOUTS = {
  sidebar: {patch: {verticalTabs: true}, view: 'full', row: id => `.sb-tab[data-tab-id="${id}"]`, close: '.sb-tab-close'},
  strip: {patch: {verticalTabs: false}, view: 'full', row: id => `.tab-strip-container [data-tab-id="${id}"]`, close: '.tab-close, .standard-tab-icon-close'},
  compact: {patch: {verticalTabs: false}, view: 'compact', row: id => `.acira-compact-tab[data-tab-id="${id}"]`, close: '.acira-compact-tab-close'},
};

await withSlot('r9-tor-close', async () => {
  const app = await startApp({root: path.resolve('.qa-profiles/r9-tor-close-' + Date.now()), ...(process.platform === 'darwin' ? {main: path.resolve('qa/mac-interface-entry.cjs')} : {})});
  try {
    // Each case runs in the ordinary window (Tor tabs beside its start-up tab) and in a Tor window (every tab is Tor).
    async function cases(ui, where, winPick, torWindow) {
    const state = () => ui.evaluate(() => window.acira.getSnapshot()), act = a => ui.evaluate(a => window.acira.dispatch(a), a);
    const tabs = async () => (await state()).tabs;
    async function open(action) {
      const before = new Set((await tabs()).map(t => t.id));
      await act(action);
      return await poll(async () => (await tabs()).find(t => !before.has(t.id)), Boolean, 'new tab', 10000);
    }
    /** What the pointer would hit at the ×'s centre while hovering the row: 'close', or the class of the element on top. */
    async function hit(layout, id) {
      const L = LAYOUTS[layout], row = ui.locator(L.row(id)).first();
      await row.hover({timeout: 5000}); await sleep(250);
      return ui.evaluate(({row, close}) => {
        const r = document.querySelector(row), button = r?.querySelector(close); if (!button) return 'no close button';
        const box = button.getBoundingClientRect(); if (!box.width) return 'close button has no size';
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return top && (top === button || button.contains(top)) ? 'close' : `covered by ${top?.tagName}.${String(top?.className?.baseVal ?? top?.className ?? '').trim().replace(/s+/g, '.')}`;
      }, {row: L.row(id), close: L.close});
    }
    const gone = async id => { try { await poll(async () => (await tabs()).some(t => t.id === id), present => !present, 'tab gone', 8000); return true; } catch { return false; } };
    const ctrlW = () => app.main(({BaseWindow}, pick) => { const all = BaseWindow.getAllWindows().sort((a, b) => a.id - b.id), win = pick === 'last' ? all[all.length - 1] : all[0], ui = win.contentView.children[0].webContents;
      const modifiers = [process.platform === 'darwin' ? 'meta' : 'control']; ui.focus(); ui.sendInputEvent({type: 'keyDown', keyCode: 'W', modifiers}); ui.sendInputEvent({type: 'keyUp', keyCode: 'W', modifiers}); }, winPick);
    const torTab = url => torWindow ? (url ? {type: 'tab.new', url} : {type: 'tab.new'}) : (url ? {type: 'tab.new', privacy: 'tor', url} : {type: 'tab.new', privacy: 'tor'});
    const site = withPage ? 'https://check.torproject.org/' : 'https://check.torproject.org/?waiting';
    for (const [name, L] of Object.entries(LAYOUTS)) {
      await act({type: 'settings.update', patch: L.patch}); await act({type: 'ui.update', patch: {view: L.view}}); await sleep(600);
      const background = await open(torTab(site + '#bg'));
      const current = await open(torTab(site + '#current'));
      await poll(async () => (await state()).activeTabId, id => id === current.id, 'Tor tab current', 5000);
      if (withPage) await poll(() => app.web(site + '#current'), Boolean, 'Tor page loaded', 300000).catch(() => {});
      await sleep(withPage ? 2500 : 600);
      if (name !== 'compact') { const h = await hit(name, background.id); check(h === 'close', `${where} · ${name} · background Tor tab: × is what the pointer hits (${h})`); }
      const h = await hit(name, current.id); check(h === 'close', `${where} · ${name} · current Tor tab: × is what the pointer hits (${h})`);
      await ui.locator(L.row(current.id)).first().locator(L.close).first().click({timeout: 5000, force: true}).catch(() => {});
      const closed = await gone(current.id); const s = await state();
      check(closed && s.tabs.some(t => t.id === s.activeTabId), `${where} · ${name} · click × on the current Tor tab closes it and another tab becomes current`);
      if (!closed) await act({type: 'tab.close', id: current.id});
      await act({type: 'tab.select', id: background.id}); await sleep(400);
      await ui.locator(L.row(background.id)).first().click({button: 'middle', timeout: 5000}).catch(() => {});
      check(await gone(background.id), `${where} · ${name} · middle-click closes the current Tor tab`);
      const third = await open(torTab()); await sleep(500);
      await ctrlW(); check(await gone(third.id), `${where} · ${name} · Ctrl+W closes the current Tor tab`);
    }
    }
    await cases(app.ui, 'ordinary window', 'first', false);
    const before = new Set(app.context.pages());
    await app.ui.evaluate(() => window.acira.openWindow('tor'));
    const torUi = await poll(async () => { for (const p of app.context.pages()) { if (before.has(p)) continue; try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'Tor window', 30000);
    await poll(() => torUi.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'Tor window ready', 30000); await sleep(1500);
    await cases(torUi, 'Tor window', 'last', true);
  } finally { await app.close(); }
});
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
