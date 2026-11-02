// Founder bug (R6): a new tab group's menu (name + colour editor) opened on the other side of the window instead of next to
// the group. This rig creates a group the way people do (right-click a tab › Move to tab group › New tab group) in every tab
// layout (sidebar, sidebar on a narrow window, horizontal strip, compact strip), dark + light, 100% + 150%, and records where
// the menu lands relative to the new group's chip (strip) or header (sidebar). It also checks Rename on an existing group.
// Real pixels of this app's own window only (desktopCapturer by media source id); synthetic input only (CDP), never the real mouse.
// Env: GE_OUT (evidence dir, default C:\ae\r6\group\evidence\<label>), GE_LABEL (before|after), GE_CASES (comma list filter).
// Takes a native slot lock C:\ae\slot-N.lock ('wx'), released in finally; one Electron; profile under .qa-profiles.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
import {takeSlot} from './r4-lib.mjs';

if (process.env.GE_HIDDEN !== '1') process.env.D_VISIBLE = '1';
const label = process.env.GE_LABEL || 'after';
const out = process.env.GE_OUT || path.join(process.platform === 'win32' ? 'C:/ae/r6/group/evidence' : 'qa/artifacts/group-editor', label);
await fs.mkdir(out, {recursive: true});

const allCases = [];
for (const layout of ['sidebar', 'strip', 'compact']) for (const theme of ['dark', 'light']) for (const scale of [100, 150]) allCases.push({layout, theme, scale, width: 1280, height: 820});
allCases.push({layout: 'sidebar', theme: 'dark', scale: 100, width: 720, height: 700, narrow: true});
allCases.push({layout: 'sidebar', theme: 'light', scale: 150, width: 900, height: 760, narrow: true});
const filter = (process.env.GE_CASES || '').split(',').filter(Boolean);
const cases = allCases.filter(c => !filter.length || filter.some(f => `${c.layout}-${c.theme}-${c.scale}${c.narrow ? '-narrow' : ''}`.includes(f)));

const releaseSlot = await takeSlot('group-editor-anchor');
let app, fx;
const results = [];
try {
  fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Page ${req.url.slice(1)}</title><body style="font:16px system-ui;padding:40px">Page ${req.url}</body>`); });
  await fs.mkdir('.qa-profiles', {recursive: true});
  const root = await fs.mkdtemp(path.resolve(`.qa-profiles/ge-${label}-`));
  app = await startApp({root});
  const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
  const popupReady = kind => poll(async () => { const o = overlay(); return o ? o.locator(`.sheet-popup[data-formation-ready]:not([inert]) .popup-content-${kind}`).count() : 0; }, n => n > 0, kind + ' open', 8000);
  const popupGone = async () => { await poll(async () => { const o = overlay(); return o ? o.locator('.sheet-popup').count() : 0; }, n => n === 0, 'popup closed', 6000).catch(() => {}); await sleep(250); };
  // Every view in the window (the overlay can be nested), with its bounds in window content DIPs.
  const views = () => app.main(({BaseWindow}) => {
    const w = BaseWindow.getAllWindows()[0], out = [];
    const walk = (view, dx, dy, depth) => { for (const child of view.children || []) { const b = child.getBounds(), at = {x: b.x + dx, y: b.y + dy, width: b.width, height: b.height}; out.push({url: child.webContents?.getURL?.() || '', bounds: at, zoom: child.webContents?.getZoomFactor?.() || 1}); if (depth < 4) walk(child, at.x, at.y, depth + 1); } };
    walk(w.contentView, 0, 0, 0);
    return {content: w.getContentBounds(), views: out};
  });
  const shot = async name => {
    const data = await app.main(async ({BaseWindow, desktopCapturer, screen}) => {
      const w = BaseWindow.getAllWindows()[0], b = w.getBounds(), f = screen.getDisplayMatching(b).scaleFactor;
      const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
      return sources.find(s => s.id === w.getMediaSourceId())?.thumbnail.toPNG().toString('base64');
    });
    if (data) await fs.writeFile(path.join(out, name + '.png'), Buffer.from(data, 'base64'));
    return data ? path.join(out, name + '.png') : null;
  };
  // A rect in a view's CSS pixels -> window content DIPs.
  const toDip = (rect, view) => rect && view && {x: view.bounds.x + rect.x * view.zoom, y: view.bounds.y + rect.y * view.zoom, width: rect.width * view.zoom, height: rect.height * view.zoom};
  const visibleRect = (page, selector) => page.evaluate(selector => { const node = [...document.querySelectorAll(selector)].find(n => !n.closest('[inert]') && n.getClientRects().length); if (!node) return null; const r = node.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; }, selector);

  for (const p of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) { await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/${p}`}); await sleep(250); }
  await sleep(1200);
  for (const c of cases) {
    const name = `${c.layout}${c.narrow ? '-narrow' : ''}-${c.theme}-${c.scale}`;
    const row = {case: name};
    try {
      await app.main(({BaseWindow}, size) => { const w = BaseWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); w.setBounds({x: 40, y: 40, width: size.width, height: size.height}); }, {width: c.width, height: c.height});
      await app.act({type: 'settings.update', patch: {appearance: c.theme, interfaceScale: c.scale, verticalTabs: c.layout === 'sidebar', language: 'en'}});
      await app.act({type: 'ui.update', patch: {view: c.layout === 'compact' ? 'compact' : 'full', workspaceOpen: c.layout === 'sidebar', webWorkspaceOpen: c.layout === 'sidebar'}});
      let state = await app.state();
      for (const group of state.tabGroups) await app.act({type: 'tab.group.remove', id: group.id});
      await sleep(1100);
      state = await app.state();
      const web = state.tabs.filter(t => /127\.0\.0\.1/.test(t.url));
      const target = web[2];
      // The compact strip can be one tab wide at 150%: there the tab is the current one, so it is on screen.
      await app.act({type: 'tab.select', id: c.layout === 'compact' ? target.id : web[0].id}); await sleep(500);
      // The compact strip lives in the toolbar, which slides away until the pointer reaches the window's top edge.
      if (c.layout === 'compact') { await app.ui.mouse.move(c.width / 2, 2); await sleep(150); await app.ui.mouse.move(c.width / 2, 20); await sleep(700); }
      const tabSel = `.sb-tab[data-tab-id="${target.id}"], .browser-tab[data-tab-id="${target.id}"], .acira-compact-tab[data-tab-id="${target.id}"]`;
      const tabRect = await poll(() => visibleRect(app.ui, tabSel), Boolean, 'target tab visible ' + name, 6000);
      // Create the group the way people do: right-click the tab › Move to tab group › New tab group.
      await app.ui.mouse.click(tabRect.x + Math.min(40, tabRect.width / 2), tabRect.y + tabRect.height / 2, {button: 'right'});
      await popupReady('tab-context');
      await overlay().getByRole('menuitem', {name: /Move to tab group/}).click(); await sleep(250);
      // Timing (R6 follow-up: the founder saw about a second before the editor): from the click on New tab group to the first
      // frame the group's menu is drawn (present and not transparent), and to the frame it reaches full opacity. Same page, one clock.
      await overlay().evaluate(() => {
        const at = window.__ge = {click: 0, first: 0, opaque: 0}, started = performance.now();
        document.addEventListener('pointerup', event => { if (!at.click && event.target.closest?.('[role=menuitem]')?.textContent?.trim() === 'New tab group') at.click = performance.now(); }, {capture: true});
        const look = () => {
          const now = performance.now(), surface = [...document.querySelectorAll('.sheet-popup:not([inert])')].find(n => n.querySelector('.popup-content-group-context'));
          const opacity = surface ? Math.min(...[surface, surface.querySelector('.popup-sheet-material')].filter(Boolean).map(n => parseFloat(getComputedStyle(n).opacity))) : 0;
          if (at.click && surface && opacity > .02 && !at.first) at.first = now;
          if (at.click && surface && opacity > .98 && !at.opaque) at.opaque = now;
          if (!at.opaque && now - started < 6000) requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      });
      // GE_PROBE=1: main-side timing of the dispatch and command that create the group and ask for its menu.
      if (process.env.GE_PROBE) row.ipcHooked = await app.main(({ipcMain}) => {
        const map = ipcMain._invokeHandlers; globalThis.__geIpc = [];
        for (const channel of ['acira:dispatch', 'acira:browser-command']) {
          const handler = map?.get(channel); if (!handler || handler.__ge) continue;
          const wrapped = async (event, ...args) => { const start = Date.now(); try { return await handler(event, ...args); } finally { globalThis.__geIpc.push({channel, type: args[0]?.type, action: args[0]?.action, kind: args[0]?.kind, start, end: Date.now()}); } };
          wrapped.__ge = true; map.set(channel, wrapped);
        }
        return !!map;
      });
      // GE_PROBE=1: per-frame trace in the chrome page of the new group's chip/header box and the animations running then.
      if (process.env.GE_PROBE) await app.ui.evaluate(() => {
        const trace = window.__geTrace = {event: 0, frames: []}, epoch = () => performance.timeOrigin + performance.now();
        window.acira.subscribeBrowser(e => { if (e?.type === 'ui' && e.action === 'open' && e.kind === 'group-context' && !trace.event) trace.event = epoch(); });
        const started = performance.now();
        const look = () => {
          const node = document.querySelector('.tab-group-badge, .sb-group-header[data-group-header]'), r = node?.getBoundingClientRect();
          if (node) trace.frames.push({t: Math.round(epoch()), x: r.x, y: r.y, w: r.width, anims: document.getAnimations().filter(a => a.playState === 'running').map(a => `${a.effect?.target?.className?.toString().split(' ')[0] || a.effect?.target?.tagName}:${a.transitionProperty || a.animationName || a.id || 'waapi'}`).slice(0, 8), inline: [...(function* () { for (let el = node; el; el = el.parentElement) if (el.style?.transform) yield `${el.className.toString().split(' ')[0]}=${el.style.transform}`; })()]});
          if (performance.now() - started < 4000 && trace.frames.length < 80) requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      });
      await overlay().getByRole('menuitem', {name: 'New tab group'}).click();
      await popupReady('group-context'); await sleep(650);
      if (process.env.GE_PROBE) row.trace = await app.ui.evaluate(() => window.__geTrace);
      if (process.env.GE_PROBE) row.ipc = await app.main(() => globalThis.__geIpc);
      if (process.env.GE_PROBE) row.clickEpoch =await overlay().evaluate(() => performance.timeOrigin + (window.__ge?.click || 0));
      if (process.env.GE_PROBE) row.firstEpoch = await overlay().evaluate(() => performance.timeOrigin + (window.__ge?.first || 0));
      const timing = await overlay().evaluate(() => window.__ge).catch(() => null);
      if (timing?.click) row.timing = {firstFrameMs: timing.first ? Math.round(timing.first - timing.click) : null, opaqueMs: timing.opaque ? Math.round(timing.opaque - timing.click) : null};
      state = await app.state();
      const group = state.tabGroups.find(g => state.tabs.some(t => t.id === target.id && t.group === g.name));
      const layout = await views(), uiView = layout.views.find(v => v.url === 'acira-browser-ui://ui/index.html'), overlayView = layout.views.find(v => v.url.includes('view=overlay'));
      const anchorCss = await visibleRect(app.ui, `.tab-group-badge[data-group-id="${group?.id}"], .sb-group-header[data-group-header="${group?.id}"]`);
      const popupCss = await overlay().evaluate(() => {
        const surface = [...document.querySelectorAll('.sheet-popup:not([inert])')].find(n => n.querySelector('.popup-content-group-context'));
        // The material box carries 24px of shadow room on every side (308 wide for a 260 menu): the panel is inside it.
        for (const node of [surface?.querySelector('.popup-sheet-material'), surface]) { const r = node?.getBoundingClientRect(); if (r && r.width > 68 && r.height > 68) return {x: r.x + 24, y: r.y + 24, width: r.width - 48, height: r.height - 48}; }
        return null;
      });
      // Each view knows where its own page sits on screen (screenX/Y, DIPs): place both rects in the chrome view's frame from that,
      // whatever offsets main gives the overlay inside its host.
      const origin = page => page.evaluate(() => ({x: window.screenX, y: window.screenY}));
      const [uiAt, overlayAt] = [await origin(app.ui), await origin(overlay())];
      const anchor = toDip(anchorCss, uiView && {bounds: {x: 0, y: 0}, zoom: uiView.zoom}), popup = toDip(popupCss, overlayView && {bounds: {x: overlayAt.x - uiAt.x, y: overlayAt.y - uiAt.y}, zoom: overlayView.zoom});
      row.origins = {uiAt, overlayAt};
      Object.assign(row, {anchor, popup, window: layout.content});
      if (anchor && popup) {
        const s = c.scale / 100, right = popup.x - (anchor.x + anchor.width), left = anchor.x - (popup.x + popup.width), below = popup.y - (anchor.y + anchor.height);
        const overlapsY = popup.y <= anchor.y + anchor.height && popup.y + popup.height >= anchor.y;
        if (c.layout === 'sidebar') row.where = right >= -2 * s && right <= 16 * s && overlapsY ? 'right of header' : left >= -2 * s && left <= 16 * s && overlapsY ? 'left of header (flipped)' : below >= -2 * s && below <= 16 * s ? 'below header' : 'away from header';
        else row.where = below >= -2 * s && below <= 16 * s && Math.abs(popup.x - anchor.x) <= 24 * s ? 'below chip' : popup.y + popup.height <= anchor.y + 2 && Math.abs(popup.x - anchor.x) <= 24 * s ? 'above chip (flipped)' : 'away from chip';
        row.ok = c.layout === 'sidebar' ? /of header/.test(row.where) : /chip/.test(row.where) && !/away/.test(row.where);
        row.gap = {right: Math.round(right), left: Math.round(left), below: Math.round(below), dx: Math.round(popup.x - anchor.x)};
      } else { row.where = 'missing ' + (!anchor ? 'anchor' : 'popup'); row.ok = false; }
      row.shot = await shot(name);
      await overlay().keyboard.press('Escape'); await popupGone();
      // Rename on an existing group, from its menu: the name field appears in place on the group's own chip/header.
      if (c.scale === 100 && group) {
        const groupSel = `.tab-group-badge[data-group-id="${group.id}"], .sb-group-header[data-group-header="${group.id}"]`;
        const before = await visibleRect(app.ui, groupSel);
        if (before) {
          await app.ui.mouse.click(before.x + Math.min(30, before.width / 2), before.y + before.height / 2, {button: 'right'});
          await popupReady('group-context'); await sleep(300);
          await overlay().getByRole('menuitem', {name: 'Rename'}).click();
          const field = await poll(() => app.ui.evaluate(() => { const n = document.activeElement; if (!n || n.tagName !== 'INPUT') return null; const r = n.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, value: n.value}; }), Boolean, 'rename field focused', 4000).catch(() => null);
          row.rename = field ? {field, at: before, inPlace: Math.abs(field.y + field.height / 2 - (before.y + before.height / 2)) <= 12 && field.x < before.x + before.width && field.x + field.width > before.x} : {inPlace: false};
          await sleep(250); row.renameShot = await shot(name + '-rename');
          await app.ui.keyboard.press('Escape'); await sleep(300);
        }
      }
    } catch (error) { row.error = String(error.message || error).slice(0, 300); row.ok = false; try { row.shot = await shot(name + '-error'); } catch {} try { await overlay()?.keyboard.press('Escape'); } catch {} await popupGone(); }
    results.push(row);
    console.log(JSON.stringify({case: row.case, where: row.where, ok: row.ok, gap: row.gap, timing: row.timing, rename: row.rename?.inPlace, error: row.error}));
  }
} finally {
  try { await app?.close(); } catch {}
  try { await fx?.close(); } catch {}
  await releaseSlot();
}
await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter(r => !r.ok || r.rename && !r.rename.inPlace);
console.log(JSON.stringify({label, out, cases: results.length, failed: failed.map(r => r.case)}));
process.exitCode = failed.length ? 1 : 0;
