// A (round 2 P0, founder: "no popup can ever be shorter or narrower than its content"). Opens every popup kind it can
// reach in its longest real state — four profiles (one with a long name), eight long-titled tabs, six long bookmarks —
// at 100% (1280×800) and 150% (1100×760), and fails when, once the popup has settled:
//  - its content is taller than the popup while the window still had room (a popup may scroll only when it fills the
//    space it can have, or by design: the palette's 13-row cap);
//  - any text sits outside the popup's padding box, or is clipped without an ellipsis;
//  - main holds it shorter than the height the overlay measured while there was room.
// Isolated, one instance per case, no focus stealing (showInactive), capped polls, ≤ 12 tabs.
//   node qa/a-popup-fit.mjs [100|150]      (A_DEBUG=1 prints every popup's numbers)
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const long = 'Northwind Research Group — Client Accounts and Quarterly Reviews';
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>${req.url.slice(1)} · ${long}</title><body style="font:16px system-ui">${req.url}</body>`); });
const base = `http://127.0.0.1:${fx.port}/`;
const only = process.argv[2] ? Number(process.argv[2]) : null;
// The third case is the founder's: 150% in a window filling the work area (taskbar showing), sidebar foot near the bottom.
const cases = [{scale: 100, width: 1280, height: 800}, {scale: 150, width: 1100, height: 760}, {scale: 150, max: true}].filter(c => only === null || c.scale === only && (!process.env.A_MAX || c.max));
const failures = [], seen = [];

// Runs in the overlay renderer: the popup's box, how much content it holds, and every text run that escapes.
const INSPECT = () => {
  const sheet = document.querySelector('.sheet-popup'); if (!sheet) return null;
  const popup = sheet.querySelector('.browser-popup') || sheet, pr = popup.getBoundingClientRect(), ps = getComputedStyle(popup);
  const inner = {left: pr.left + parseFloat(ps.paddingLeft) - 1, right: pr.right - parseFloat(ps.paddingRight) + 1, top: pr.top, bottom: pr.bottom};
  const scrollers = [], escapes = [], clipped = [];
  // Elements that scroll their content: text inside them is judged by the scroller, not by the popup's box.
  const scrollerEls = [...popup.querySelectorAll('*')].filter(e => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1; });
  for (const el of popup.querySelectorAll('*')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[aria-hidden="true"],[inert],.popup-vapor')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || !el.checkVisibility({contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true})) continue; // closed <details> bodies are laid out but never painted
    if (['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 20) scrollers.push({cls: String(el.className).slice(0, 40), over: el.scrollHeight - el.clientHeight, scrolls: cs.overflowY === 'auto' || cs.overflowY === 'scroll'});
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (!own) continue;
    // Text inside a scroller is judged by the scroller; text in a moving drill-in pane is off-screen by design.
    const scroller = [...scrollerEls].some(s => s !== el && s.contains(el));
    const range = document.createRange(); range.selectNodeContents(el); const t = range.getBoundingClientRect();
    const text = el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40), ellipsis = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
    if (el.scrollWidth > el.clientWidth + 1 && !ellipsis && ['hidden', 'clip'].includes(cs.overflowX)) clipped.push(text);
    if (t.width && (t.left < inner.left || t.right > inner.right) && !(ellipsis && el.scrollWidth > el.clientWidth)) escapes.push(`${text} [${Math.round(t.left)}–${Math.round(t.right)} vs ${Math.round(inner.left)}–${Math.round(inner.right)}]`);
    if (t.height && !scroller && (t.top < inner.top - 1 || t.bottom > inner.bottom + 1)) escapes.push(`${text} [below the popup: ${Math.round(t.bottom)} > ${Math.round(inner.bottom)}]`);
  }
  return {rect: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)], viewport: [innerWidth, innerHeight], scrollers, escapes: escapes.slice(0, 4), clipped: clipped.slice(0, 4)};
};

for (const c of cases) {
  const name = c.max ? `${c.scale}% maximized` : `${c.scale}% ${c.width}×${c.height}`;
  const root = `.qa-profiles/a-popup-fit-${c.scale}${c.max ? '-max' : ''}`; await fs.rm(root, {recursive: true, force: true});
  const app = await startApp({root, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout());
  const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
  const close = async () => {
    for (let i = 0; i < 4 && (await layout())?.overlay; i++) { await overlay()?.keyboard.press('Escape').catch(() => {}); await app.ui.keyboard.press('Escape').catch(() => {}); await sleep(250); }
    const open = (await layout())?.overlay; if (open) await app.ui.evaluate(id => window.acira.closeOverlay(id), open.id);
    await sleep(300);
  };
  const click = selector => app.ui.locator(selector).filter({visible: true}).first().click();
  const fromPopup = async (parent, text) => { await poll(async () => (await layout())?.overlay?.kind === parent, Boolean, parent, 4000); await sleep(350); await overlay().locator('.menu-row', {hasText: text}).first().click(); };
  const menuRow = async text => { await click('[aria-label="Acira menu"]'); await fromPopup('menu', text); };
  const contextMenu = (selector, x, y) => app.ui.evaluate(([s, cx, cy]) => { const n = [...document.querySelectorAll(s)].find(e => e.checkVisibility()); const r = n.getBoundingClientRect(); n.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: cx ?? r.x + r.width / 2, clientY: cy ?? r.y + r.height / 2})); }, [selector, x, y]);
  // Every step is bounded: a stall reports the step that stalled instead of freezing the run.
  const bounded = (p, ms, what) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`stalled > ${ms}ms: ${what}`)), ms))]);
  async function check(kind, label, open, prepare, options = {}) {
    try { await bounded(checkOnce(kind, label, open, prepare, options), 45000, `${kind} (${label})`); }
    catch (error) { failures.push(`${name} ${kind} (${label}): ${String(error.message || error).slice(0, 160)}`); await bounded(close(), 15000, 'close').catch(() => {}); }
  }
  async function checkOnce(kind, label, open, prepare, {keep = false} = {}) {
    if (process.env.A_ONLY && !process.env.A_ONLY.split(',').includes(kind)) return;
    if (!keep) await close();
    try { await open(); } catch (error) { failures.push(`${name} ${kind} (${label}): could not open: ${String(error).split('\n')[0].slice(0, 120)}`); return; }
    const opened = await poll(async () => (await layout())?.overlay?.kind === kind, Boolean, kind, 4000).catch(() => false);
    if (!opened) { failures.push(`${name} ${kind} (${label}): did not open (open: ${(await layout())?.overlay?.kind || 'none'})`); return; }
    const trace = m => process.env.A_TRACE && console.log(`   [${kind}] ${m}`);
    trace('opened'); if (prepare) await prepare(); trace('prepared');
    await sleep(900);
    trace('reading layout'); const held = (await layout())?.overlay; trace('reading overlay'); const seen1 = await overlay()?.evaluate(INSPECT).catch(e => ({error: String(e).slice(0, 80)})); trace('read');
    if (process.env.A_DUMP) console.log(await overlay().evaluate(sel => [...document.querySelectorAll('.sheet-popup *')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && new RegExp(sel).test(n.textContent))).map(e => { const chain = []; for (let p = e; p && !p.classList?.contains('sheet-popup'); p = p.parentElement) { const cs = getComputedStyle(p); chain.push(`${p.tagName.toLowerCase()}.${String(p.className).split(' ')[0]}${cs.position !== 'static' ? '/' + cs.position : ''}${cs.transform !== 'none' ? '/T' : ''}${cs.overflow !== 'visible' ? '/ov:' + cs.overflow : ''}${p.hidden ? '/hidden' : ''}${+cs.opacity < 1 ? '/op' + cs.opacity : ''}`); } return Math.round(e.getBoundingClientRect().top) + ' ' + chain.join(' < '); }).join('\n'), process.env.A_DUMP));
    if (!held || !seen1) { failures.push(`${name} ${kind} (${label}): closed by itself`); return; }
    const vh = seen1.viewport[1], room = held.bounds.y + held.contentHeight <= vh - 8 && held.bounds.y >= 0;
    if (process.env.A_DEBUG) console.log(`${name} ${kind} (${label}) held ${held.bounds.height}/${held.contentHeight} at y ${held.bounds.y} in ${vh}`, JSON.stringify(seen1));
    seen.push(`${name} ${kind} (${label}): ${held.bounds.width}×${held.bounds.height}`);
    const bad = [];
    if (held.bounds.height < held.contentHeight - 1 && room) bad.push(`held ${held.bounds.height}px for ${held.contentHeight}px of content with room in a ${vh}px window`);
    for (const s of seen1.scrollers) if (!s.scrolls) bad.push(`content clipped by ${s.over}px in .${s.cls}`);
    else if (room && kind !== 'palette') bad.push(`scrolls ${s.over}px (.${s.cls}) though the window had room`);
    for (const e of seen1.escapes) bad.push(`text outside the padding box: ${e}`);
    for (const t of seen1.clipped) bad.push(`text clipped without an ellipsis: ${t}`);
    if (bad.length) failures.push(`${name} ${kind} (${label}): ${bad.join('; ')}`);
  }
  try {
    await app.main(({BaseWindow, screen}, [w, h]) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds(w ? {x: 60, y: 40, width: w, height: h} : screen.getDisplayMatching(win.getBounds()).workArea); win.showInactive(); }, [c.width, c.height]);
    await app.act({type: 'settings.update', patch: {interfaceScale: c.scale, verticalTabs: false, appearance: 'light'}});
    for (const [n, color] of [['Work', '#266a98'], ['Studio', '#7d4f8a'], [long, '#2f7d5b']]) {
      await app.act({type: 'browser.profile.create', name: n}); await sleep(300);
      const made = (await app.state()).browserProfiles.find(p => p.name === n); if (made) await app.act({type: 'browser.profile.update', id: made.id, color, email: `${n.split(' ')[0].toLowerCase()}.account.reviews@northwind-research-group.example`});
    }
    await app.act({type: 'tab.new', url: base + 'a'}); await app.waitWeb(base + 'a'); await sleep(600);
    for (const q of ['b', 'c', 'd', 'e', 'f', 'g']) await app.act({type: 'tab.new', url: base + q, background: true});
    await sleep(1500); for (const q of ['b', 'c', 'd', 'e', 'f', 'g']) await app.act({type: 'bookmark.toggle', url: base + q}); // open tabs: their long titles
    await sleep(4000); // created-profile toasts clear
    if (process.env.A_COLD) { await app.act({type: 'settings.update', patch: {verticalTabs: true}}); await app.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}}); await sleep(900); await check('profile', 'cold, first popup of the session', () => app.ui.evaluate(() => document.querySelector('.sb-foot-profile, [aria-label$="Switch profile"]').click())); await close(); await app.act({type: 'settings.update', patch: {verticalTabs: false}}); await sleep(600); }
    const select = async url => app.act({type: 'tab.select', id: (await app.state()).tabs.find(t => t.url === url).id});
    await select(base + 'a'); await sleep(500);
    await check('menu', 'web tab', () => click('[aria-label="Acira menu"]'));
    await check('more-tools', 'from the menu', () => menuRow('More tools'));
    await check('tabs', '8 tabs', () => app.ui.keyboard.press('Alt+t'));
    await check('palette', '8 tabs', () => app.ui.keyboard.press('Control+Shift+K'));
    await check('security', 'web page', () => click('[aria-label="Page information"]'));
    await check('bookmarks', '6 long bookmarks', () => menuRow('Bookmarks'));
    await check('downloads', 'none yet', () => menuRow('Downloads'));
    await check('extensions', 'none yet', async () => { await menuRow('More tools'); await fromPopup('more-tools', 'Extensions'); });
    await check('toolbar-context', 'toolbar', () => contextMenu('.browser-toolbar', 230, 40));
    await check('customize-toolbar', 'from the toolbar menu', async () => { await contextMenu('.browser-toolbar', 230, 40); await fromPopup('toolbar-context', 'Customize toolbar'); });
    await check('tab-context', 'web tab', async () => { const t = (await app.state()).tabs.find(x => x.url === base + 'b'); await contextMenu(`.browser-tab[data-tab-id="${t.id}"]`); });
    await check('strip-context', 'strip', () => contextMenu('.tabs-strip', 900, 16));
    // Tor's chip panel in its longest real state (the unreachable error), injected the way N's states check does; Tor never starts.
    const torLong = {version: '0.4.9.14', firstConnection: true, state: 'error', progress: 50, phase: 'Can’t reach the Tor network', error: {code: 'unreachable', title: 'Can’t reach the Tor network', detail: 'Your network may block Tor. Check your connection and try again. Bridges, for networks that block Tor, are coming in a later version.'}};
    await check('tor', 'unreachable error', () => app.ui.evaluate(async () => { const s = await window.acira.getSnapshot(); await window.acira.browserCommand({type: 'ui', tabId: s.activeTabId, action: 'open', kind: 'tor', anchor: {x: 600, y: 40, width: 28, height: 28}}); }), () => overlay().evaluate(st => window.dispatchEvent(new CustomEvent('acira-tor-preview', {detail: st})), torLong));
    await check('find', 'web page', () => app.ui.keyboard.press('Control+f'));
    await check('zoom', 'web page', () => app.ui.keyboard.press('Control+='));
    await close(); await app.ui.keyboard.press('Control+0'); await sleep(300);
    // Edit bookmark opens from a bookmark's right-click menu (the star only toggles); the bar shows the six long bookmarks.
    await app.act({type: 'settings.update', patch: {bookmarksBar: true, bookmarksOnNewTabOnly: false}}); await sleep(700);
    await check('bookmark-context', 'bookmarks bar', () => contextMenu('.bookmarks-bar button[data-bookmark]'));
    // Edit… edits in place: the same menu grows to hold the editor (content that changes while the popup is open).
    await check('bookmark-context', 'editing a long bookmark in place', () => contextMenu('.bookmarks-bar button[data-bookmark]'), async () => { await sleep(400); await overlay().locator('.menu-row, button', {hasText: 'Edit'}).first().click(); });
    // Profiles in the sidebar too.
    await close(); await app.act({type: 'settings.update', patch: {verticalTabs: true}}); await app.act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}}); await sleep(900);
    // Edit favorite grows from its tile (G, on A's panel spec): a long name and a long address.
    await app.ui.evaluate(async name => { const s = await window.acira.getSnapshot(); localStorage.setItem('acira-sidebar-apps:' + s.activeBrowserProfileId, JSON.stringify({seeded: true, hidden: false, apps: [{id: 'fit-fav', url: 'https://northwind.example.com/accounts/quarterly-reviews', title: name}]})); window.dispatchEvent(new Event('acira-sidebar-apps')); }, long); await sleep(500);
    await check('favorite-edit', 'long favorite from its tile', () => contextMenu('.acira-sidebar .sb-app[data-app-id]'));
    const profileButton = () => app.ui.evaluate(() => { const b = document.querySelector('.sb-foot-profile, [aria-label$="Switch profile"]'); if (!b) throw new Error('no profile button'); b.click(); });
    await check('profile', 'sidebar, 4 profiles', profileButton);
    // The founder clicks around: the profile panel opened while the menu is still open (one popup turns into the other).
    // In sidebar mode the menu is opened by its command (its toolbar button may be folded away).
    await close(); await app.cmd({type: 'ui', tabId: (await app.state()).activeTabId, action: 'open', kind: 'menu'}); await poll(async () => (await layout())?.overlay?.kind === 'menu', Boolean, 'menu', 4000).catch(() => {}); await sleep(500);
    await check('profile', 'opened over the open menu', profileButton, undefined, {keep: true});
    // A profile added while the panel is open: the panel grows to hold it.
    await check('profile', 'a fifth profile added while open', profileButton, async () => { await app.act({type: 'browser.profile.create', name: 'Family'}); await sleep(300); });
  } finally { await app.close(); }
}
fx.close?.();
console.log(`${seen.length} popups checked`);
console.log(failures.length ? `FAIL (${failures.length})\n${failures.join('\n')}` : 'PASS: every popup holds its content inside its padding box at 100% and 150%');
process.exitCode = failures.length ? 1 : 0;
