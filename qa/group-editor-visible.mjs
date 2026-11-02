// Group editor anchoring (open item from R6): in a narrow window, and at 150%, the tab strips clip their group chips, and the
// group editor opened under a chip that was out of view. Real app, one native slot, isolated profile, hidden window (no focus
// taken, no OS cursor: synthetic CDP input into the app's own pages only). Every layout (compact row, horizontal strip,
// sidebar) x scale (150, 100) x window width (narrowest, 1100) x entry point:
//   chip-menu  right-click on the visible part of a group chip that sits half under the strip's left edge (sidebar: its header)
//   chip-key   the chip (sidebar: header) focused while half out of view, Shift+F10
//   tab-menu   right-click the left-most visible ungrouped tab > Move to tab group > New tab group (its chip is created
//              left of the tab, so in a scrolled strip it starts out of view)
//   tab-key    the same from the keyboard: Shift+F10 on the tab, Enter on the rows
// Each case checks the editor's panel (.browser-popup in the overlay page, in window DIPs): fully inside the window; hanging
// from an element that is visible (its box cut by every clipping ancestor, at least 12px wide): the group's chip/header, the
// strip's overflow control on the chip's side, or the pointer of a right-click made on the visible chip; never from the
// hidden part of a chip. Writes a composite of the window's views (capturePage of each view, z-ordered) per case.
// Usage (worktree root): node qa/group-editor-visible.mjs [outDir]    env GE_ONLY=<regex on layout-scale-width>, GE_THEME=light, GE_LANG=de
// Exit 1 when any case fails.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
import { withSlot } from './native-slot.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.resolve(process.argv[2] || 'C:/ae/r7/group-editor'); await fs.mkdir(OUT, { recursive: true });
const ONLY = process.env.GE_ONLY ? new RegExp(process.env.GE_ONLY) : null, THEME = process.env.GE_THEME || 'dark', LANG = process.env.GE_LANG || 'en';
// The tab menu's rows are English literals in every language today (German: 'Move to tab group', 'New tab group' unchanged), so one label serves all.
const MOVE_ROW = 'Move to tab group';
const results = [];
const log = (...a) => console.log('[group-editor]', ...a);

await withSlot('group-editor-visible', async () => {
  let app;
  const watchdog = setTimeout(() => { log('watchdog: closing'); void app?.close().catch(() => {}); }, 14 * 60_000); watchdog.unref();
  try {
    app = await launchPreparedNative({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [path.resolve('desktop/main.cjs')],
      env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: path.resolve(`.qa-profiles/group-editor-${Date.now()}`), ACIRA_BROWSER_TEST_HIDDEN: '1' },
      timeout: 60000,
    });
    const pick = async test => { for (let i = 0; i < 300; i++) { for (const p of app.windows()) { try { if (test(p.url())) return p; } catch {} } await sleep(100); } throw Error('page not found'); };
    let ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
    try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 15000 }); } catch {}
    await sleep(1200); ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
    const overlay = () => pick(u => u.startsWith('acira-browser-ui://ui/index.html?view=overlay'));
    const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
    const snap = () => ui.evaluate(() => window.acira.getSnapshot());
    // 14 tabs on Acira's own new tab page (no network); the last one is active, so a scrolling strip sits at its end.
    for (let i = 0; i < 13; i++) { const before = (await snap()).tabs.length; await act({ type: 'tab.new' }); if ((await snap()).tabs.length !== before + 1) throw Error('tab.new did not add exactly one tab'); }
    await sleep(800);
    // A hidden window never paints a frame on its own (its strip motion and the editor's reveal stall), so the window is shown
    // INACTIVE (never focused: the test window is not focusable) on a second display when there is one (GE_DISPLAY=<index>).
    const display = await app.evaluate(({ screen }, want) => { const all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay(); const pick = want !== '' && all[Number(want)] || all.find(d => d.id !== primary.id) || primary; return { x: pick.workArea.x, y: pick.workArea.y, scale: pick.scaleFactor, count: all.length }; }, process.env.GE_DISPLAY ?? '');
    log('display', JSON.stringify(display));
    const setBounds = (width, height) => app.evaluate(({ BaseWindow }, b) => { const w = BaseWindow.getAllWindows().sort((a, c) => c.getBounds().width - a.getBounds().width)[0]; const at = { x: b.x + 40, y: b.y + 40, width: b.width, height: b.height }; w.setBounds(at); w.setBounds(at); if (!w.isVisible()) w.showInactive(); return w.getContentBounds(); }, { width, height, x: display.x, y: display.y });
    const zooms = () => app.evaluate(({ BaseWindow, webContents }) => {
      const win = BaseWindow.getAllWindows().sort((a, c) => c.getBounds().width - a.getBounds().width)[0], all = webContents.getAllWebContents();
      const ui = all.find(w => w.getURL() === 'acira-browser-ui://ui/index.html'), ov = all.find(w => w.getURL().includes('?view=overlay'));
      return { ui: ui.getZoomFactor(), overlay: ov?.getZoomFactor() || 1, content: win.getContentBounds() };
    });
    // The editor's panel in window DIPs: the overlay WebContentsView sits inside a clip View (desktop/main.cjs host('overlay')).
    const panel = async () => {
      const host = await app.evaluate(({ BaseWindow }) => {
        const win = BaseWindow.getAllWindows().sort((a, c) => c.getBounds().width - a.getBounds().width)[0];
        for (const view of win.contentView.children) for (const child of view.children || []) if (child.webContents?.getURL().includes('?view=overlay')) return { visible: view.getVisible(), box: view.getBounds(), inner: child.getBounds() };
        return null;
      });
      if (!host?.visible) return null;
      const o = await overlay(), z = await zooms();
      const r = await o.evaluate(() => { const n = document.querySelector('.browser-popup'); if (!n) return null; const b = n.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, kind: n.className, text: n.innerText.replace(/\s+/g, ' ').slice(0, 60) }; });
      if (!r) return null;
      const ox = host.box.x + host.inner.x, oy = host.box.y + host.inner.y, k = z.overlay;
      return { left: ox + r.left * k, top: oy + r.top * k, right: ox + r.right * k, bottom: oy + r.bottom * k, kind: r.kind, text: r.text, content: z.content };
    };
    const closePopup = async () => { for (let i = 0; i < 4; i++) { if (!await panel()) break; try { const o = await overlay(); await o.keyboard.press('Escape'); } catch {} await sleep(350); } await sleep(300); };
    // The visible part of an element: its box cut by every ancestor that clips (overflow other than visible) and the window.
    const inPage = (sel, gid) => ui.evaluate(({ sel, gid }) => {
      const node = [...document.querySelectorAll(sel)].find(n => (!gid || n.dataset.groupId === gid || n.dataset.groupHeader === gid) && !n.closest('[inert]') && n.getClientRects().length);
      if (!node) return null;
      const b = node.getBoundingClientRect(); let box = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      for (let el = node.parentElement; el; el = el.parentElement) {
        const cs = getComputedStyle(el); if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const c = el.getBoundingClientRect();
        if (cs.overflowX !== 'visible') { box.left = Math.max(box.left, c.left); box.right = Math.min(box.right, c.right); }
        if (cs.overflowY !== 'visible') { box.top = Math.max(box.top, c.top); box.bottom = Math.min(box.bottom, c.bottom); }
      }
      box.left = Math.max(0, box.left); box.top = Math.max(0, box.top); box.right = Math.min(innerWidth, box.right); box.bottom = Math.min(innerHeight, box.bottom);
      return { full: { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, visible: box, visibleWidth: Math.max(0, box.right - box.left), visibleHeight: Math.max(0, box.bottom - box.top), hidden: node.getAttribute('aria-hidden') === 'true' };
    }, { sel, gid });
    // Every view of the window, back to front, each cut to its parents (the hidden window has no OS capture).
    const shot = async (name, mark) => {
      const parts = await app.evaluate(async ({ BaseWindow }) => {
        const win = BaseWindow.getAllWindows().sort((a, c) => c.getBounds().width - a.getBounds().width)[0], out = [];
        const walk = async (view, ox, oy, clip) => {
          for (const child of view.children || []) {
            if (!child.getVisible()) continue;
            const b = child.getBounds(), x = ox + b.x, y = oy + b.y;
            const c = { x: Math.max(clip.x, x), y: Math.max(clip.y, y), r: Math.min(clip.r, x + b.width), b: Math.min(clip.b, y + b.height) };
            if (c.r <= c.x || c.b <= c.y) continue;
            if (child.webContents && !child.webContents.isDestroyed()) {
              const img = await child.webContents.capturePage();
              if (!img.isEmpty()) out.push({ url: img.toDataURL(), ratio: img.getSize().width / b.width, sx: c.x - x, sy: c.y - y, x: c.x, y: c.y, w: c.r - c.x, h: c.b - c.y });
            }
            await walk(child, x, y, c);
          }
        };
        const cb = win.getContentBounds(); await walk(win.contentView, 0, 0, { x: 0, y: 0, r: cb.width, b: cb.height });
        return { parts: out, width: cb.width, height: cb.height };
      });
      const data = await ui.evaluate(async ({ parts, width, height, mark }) => {
        const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
        const k = 1, c = new OffscreenCanvas(Math.round(width * k), Math.round(height * k)), g = c.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
        for (const p of parts) g.drawImage(await load(p.url), p.sx * p.ratio, p.sy * p.ratio, p.w * p.ratio, p.h * p.ratio, p.x * k, p.y * k, p.w * k, p.h * k);
        if (mark) { g.strokeStyle = '#ff2bd6'; g.lineWidth = 1; g.strokeRect(mark.left + .5, mark.top + .5, mark.right - mark.left - 1, mark.bottom - mark.top - 1); }
        const blob = await c.convertToBlob({ type: 'image/png' }), bytes = new Uint8Array(await blob.arrayBuffer());
        let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s);
      }, { ...parts, mark });
      await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    };
    const stripSel = { compact: '.acira-compact-tabs-viewport', horizontal: '.tab-strip-viewport', sidebar: '.sb-tabs-scroll,.sb-tabs,.ed-rail' };
    const overflowSel = { compact: ['.acira-compact-scroll.previous', '.acira-compact-scroll.next', '.toolbar-tab-overview'], horizontal: ['.standard-tabs-scroll.previous', '.standard-tabs-scroll.next'], sidebar: [] };
    const chipSel = layout => layout === 'sidebar' ? '.sb-group-header[data-group-header]' : '.tab-group-badge';
    // Scroll the strip so the group's chip is half under its left edge (the strip keeps a scroll it is given).
    const halfHide = (layout, gid) => ui.evaluate(({ sel, gid }) => {
      const strip = [...document.querySelectorAll(sel)].find(n => n.getClientRects().length && !n.closest('[inert]')), chip = [...document.querySelectorAll('.tab-group-badge')].find(n => n.dataset.groupId === gid && !n.closest('[inert]') && n.getClientRects().length);
      if (!strip || !chip) return false; const s = strip.getBoundingClientRect(), c = chip.getBoundingClientRect();
      strip.scrollLeft += c.left + c.width / 2 - s.left; return true;
    }, { sel: stripSel[layout], gid });
    // Compact: the row collapses after a new tab only once the address field lets go (ui/compactChrome.ts): Esc in the window.
    const settleCompact = async layout => { if (layout !== 'compact') return true; await ui.evaluate(() => document.activeElement?.blur?.()); await ui.keyboard.press('Escape'); await sleep(700); return ui.evaluate(() => !!document.querySelector('.acira-compact-tabs')); };
    async function judge(label, layout, gid, k, pointer) {
      await sleep(900);
      const p = await panel();
      const chip = await inPage(chipSel(layout), gid);
      const controls = []; for (const sel of overflowSel[layout]) { const c = await inPage(sel); if (c && !c.hidden && c.visibleWidth >= 12) controls.push({ sel, ...c }); }
      const dip = r => r && { left: r.left * k, top: r.top * k, right: r.right * k, bottom: r.bottom * k };
      const ok = [], bad = [];
      if (!p) bad.push('no editor shown');
      else {
        const W = p.content.width, H = p.content.height;
        (p.left >= 0 && p.top >= 0 && p.right <= W + .5 && p.bottom <= H + .5 ? ok : bad).push(`panel inside the window ${[p.left, p.top, p.right, p.bottom].map(Math.round)} in ${W}x${H}`);
        const near = (a, b, d = 14) => Math.abs(a - b) <= d;
        // Under or over it (an edge of the panel on one of its edges, overlapping it), or beside it (sidebar), or at the pointer.
        const hangs = r => r && (
          // (the popup's 12px window margin and every tolerance are CSS px: x k in window DIPs)
          (p.left < r.right && p.right > r.left && ((p.top >= r.bottom - 2 && p.top <= r.bottom + 10 * k) || (p.bottom <= r.top + 2 && p.bottom >= r.top - 10 * k)) && (near(p.left, r.left, 4 * k) || near(p.right, r.right, 4 * k) || (p.left >= r.left - 2 && p.right <= r.right + 2) || near(p.left, 12 * k, 2 * k) || near(p.right, W - 12 * k, 2 * k) || Math.min(p.right, r.right) - Math.max(p.left, r.left) >= Math.min(r.right - r.left, 24 * k) / 2))
          || (layout === 'sidebar' && p.top < r.bottom + 10 * k && p.bottom > r.top - 10 * k && (near(p.left, r.right, 12 * k) || near(p.right, r.left, 12 * k))));
        const atPointer = pointer && (near(p.left, pointer.x, 6) || near(p.right, pointer.x, 6)) && (near(p.top, pointer.y, 6) || near(p.bottom, pointer.y, 6));
        const chipVisible = chip && chip.visibleWidth >= 12 && chip.visibleHeight >= 8 ? dip(chip.visible) : null;
        const pointerOnChip = atPointer && chipVisible && pointer.x >= chipVisible.left && pointer.x <= chipVisible.right && pointer.y >= chipVisible.top && pointer.y <= chipVisible.bottom;
        const fromChip = chipVisible && hangs(chipVisible), fromControl = controls.find(c => hangs(dip(c.visible)));
        const underHidden = chip && !fromChip && !fromControl && !pointerOnChip && hangs(dip(chip.full));
        if (fromChip) ok.push(`hangs from the visible chip ${[chipVisible.left, chipVisible.right].map(Math.round)} (chip ${Math.round(chip.visibleWidth)}/${Math.round(chip.full.right - chip.full.left)}px shown)`);
        else if (pointerOnChip) ok.push(`at the pointer on the visible chip ${Math.round(pointer.x)},${Math.round(pointer.y)}`);
        else if (fromControl) ok.push(`hangs from the overflow control ${fromControl.sel} (chip ${chip ? Math.round(chip.visibleWidth) : 'none'}px shown)`);
        else bad.push(`hangs from nothing visible${underHidden ? ' (UNDER THE CLIPPED CHIP)' : ''}; chip ${JSON.stringify(chip && { full: dip(chip.full), shown: Math.round(chip.visibleWidth) })} panel ${[p.left, p.top, p.right, p.bottom].map(Math.round)}`);
      }
      if (p) ok.push(`shows "${p.text}"`);
      const lay = await ui.evaluate(async () => { const l = await window.acira.getBrowserLayout(); const o = l?.overlay; return o && { kind: o.kind, bounds: o.bounds, anchor: o.context?.anchor || o.anchor, contentHeight: o.contentHeight }; }).catch(e => String(e));
      ok.push('layout ' + JSON.stringify(lay));
      const pass = !bad.length; results.push({ label, pass, ok, bad }); log(pass ? 'PASS' : 'FAIL', label, ...(pass ? ok : [...bad, ...ok]));
      await shot(label.replace(/[^a-z0-9-]+/gi, '_'), p && { left: p.left, top: p.top, right: p.right, bottom: p.bottom });
      await closePopup();
    }
    for (const layout of ['compact', 'horizontal', 'sidebar']) for (const scale of [150, 100]) for (const width of [700, 1100]) {
      const tag = `${layout}-${scale}-${width}`;
      if (ONLY && !ONLY.test(tag)) continue;
      const settings = { interfaceScale: scale, appearance: THEME, language: LANG, verticalTabs: layout === 'sidebar', windowView: layout === 'compact' ? 'compact' : 'full' };
      await act({ type: 'settings.update', patch: settings }); await setBounds(width, 720); await sleep(900);
      let s = await snap();
      for (const g of s.tabGroups) await act({ type: 'tab.group.remove', id: g.id });
      s = await snap(); const ids = s.tabs.map(t => t.id);
      if (layout === 'sidebar') await act({ type: 'ui.update', patch: { workspaceOpen: true } });
      // An existing group on the first two tabs (in a scrolled strip its chip is out of view on the left).
      await act({ type: 'tab.group.create', tabId: ids[0], name: 'Reading', color: 'green' });
      s = await snap(); const gid = s.tabGroups.at(-1).id; await act({ type: 'tab.group.assign', tabIds: [ids[1]], groupId: gid });
      await act({ type: 'tab.select', id: ids.at(-1) }); await sleep(1100);
      if (!await settleCompact(layout)) { results.push({ label: `${tag}-setup`, pass: false, bad: ['compact row did not show'] }); continue; }
      const k = (await zooms()).ui;
      await shot(`${tag}-setup`);
      // A compact row too narrow for one tab is condensed (the strip is inert, width 0): no chip or tab on screen to click, so
      // the chip cases do not apply and the tab menu is opened from the tab overview button (as its list's rows do).
      const condensed = layout === 'compact' && await ui.evaluate(() => document.querySelector('.acira-compact-tabs')?.dataset.condensed === 'true');
      if (condensed) for (const via of ['chip-menu', 'chip-key']) results.push({ label: `${tag}-${via}`, pass: true, ok: ['n/a: compact row condensed, no chip on screen'], bad: [] });
      // chip-menu
      if (layout !== 'sidebar' && !condensed) await halfHide(layout, gid);
      await sleep(400);
      let c = condensed ? null : await inPage(chipSel(layout), gid);
      if (condensed) {}
      else if (c && c.visibleWidth >= 4) {
        const x = (c.visible.left + Math.min(c.visible.right, c.visible.left + 40)) / 2, y = (c.visible.top + c.visible.bottom) / 2;
        await ui.mouse.click(x, y, { button: 'right' }); await judge(`${tag}-chip-menu`, layout, gid, k, { x: x * k, y: y * k });
      } else results.push({ label: `${tag}-chip-menu`, pass: false, bad: ['could not show half of the chip ' + JSON.stringify(c)] });
      // chip-key
      if (layout !== 'sidebar' && !condensed) { await halfHide(layout, gid); await sleep(300); }
      const focused = condensed ? 'skip' : await ui.evaluate(({ gid, side }) => { const n = [...document.querySelectorAll(side ? '.sb-group-header[data-group-header]' : '.tab-group-badge')].find(n => (n.dataset.groupId || n.dataset.groupHeader) === gid && !n.closest('[inert]') && n.getClientRects().length); if (!n) return 'no chip'; n.focus({ preventScroll: true }); const a = document.activeElement; return a === n || 'focus went to ' + (a?.className || a?.tagName); }, { gid, side: layout === 'sidebar' });
      if (focused === true) { await ui.keyboard.press('Shift+F10'); await judge(`${tag}-chip-key`, layout, gid, k); }
      else if (focused !== 'skip') results.push({ label: `${tag}-chip-key`, pass: false, bad: ['chip not focusable: ' + focused] });
      // tab-menu / tab-key: the left-most fully visible ungrouped tab.
      const tabSel = layout === 'compact' ? '.acira-compact-tab[data-tab-id]' : layout === 'horizontal' ? '.browser-tab[data-tab-id]' : '.sb-tab[data-tab-id]';
      for (const via of ['tab-menu', 'tab-key']) {
        s = await snap(); for (const g of s.tabGroups) if (g.id !== gid) await act({ type: 'tab.group.remove', id: g.id });
        if (layout !== 'sidebar') await halfHide(layout, gid);
        await sleep(600);
        // The left-most ungrouped tab that is in view (at least 90% of its width: a narrow compact row may show only one).
        // When the strip shows none, it is scrolled so the first ungrouped tab sits at its left edge (the group's chip just out of view).
        const pickTab = (scrollTo) => ui.evaluate(({ tabSel, strip, scrollTo }) => {
          const node = [...document.querySelectorAll(strip)].find(n => n.getClientRects().length && !n.closest('[inert]')), s = node?.getBoundingClientRect();
          const tabs = [...document.querySelectorAll(tabSel)].filter(n => !n.dataset.tabGroup && !n.closest('[inert]') && n.getClientRects().length).map(n => ({ id: n.dataset.tabId, r: n.getBoundingClientRect() }));
          if (scrollTo && node && tabs[0]) { node.scrollLeft += tabs[0].r.left - s.left; return null; }
          const shown = t => !s ? 1 : Math.max(0, Math.min(t.r.right, s.right) - Math.max(t.r.left, s.left)) / t.r.width;
          const seen = tabs.filter(t => shown(t) >= .9 && (!s || (t.r.top >= s.top - 2 && t.r.bottom <= s.bottom + 2)));
          const t = seen[0]; return t && { id: t.id, x: Math.max(t.r.left, s?.left ?? 0) + Math.min(t.r.width, 40) / 2, y: t.r.top + t.r.height / 2 };
        }, { tabSel, strip: stripSel[layout], scrollTo });
        let t = condensed ? null : await pickTab(false);
        if (!t && layout !== 'sidebar' && !condensed) { await pickTab(true); await sleep(400); t = await pickTab(false); }
        if (condensed) {
          const opened = await ui.evaluate(({ id, active }) => { const b = document.querySelector('.toolbar-tab-overview')?.getBoundingClientRect(); if (!b?.width) return false; void window.acira.browserCommand({ type: 'ui', tabId: active, action: 'open', kind: 'tab-context', targetTabId: id, anchor: { x: Math.round(b.left), y: Math.round(b.bottom), width: 2, height: 2 } }); return true; }, { id: ids[3], active: s.activeTabId });
          if (!opened) { results.push({ label: `${tag}-${via}`, pass: false, bad: ['condensed: no tab overview button'] }); continue; }
        }
        else if (!t) { results.push({ label: `${tag}-${via}`, pass: false, bad: ['no visible ungrouped tab'] }); continue; }
        else if (via === 'tab-menu') await ui.mouse.click(t.x, t.y, { button: 'right' });
        else { await ui.evaluate(({ tabSel, id }) => { const n = [...document.querySelectorAll(tabSel)].find(n => n.dataset.tabId === id && !n.closest('[inert]')); (n?.querySelector('.sb-tab-main') || n)?.focus({ preventScroll: true }); }, { tabSel, id: t.id }); await ui.keyboard.press('Shift+F10'); }
        await sleep(700);
        const o = await overlay();
        const row = async label => { const r = o.locator('[role=menuitem]', { hasText: label }).first(); if (via === 'tab-menu') await r.click({ timeout: 4000 }); else { await r.focus({ timeout: 4000 }); await o.keyboard.press('Enter'); } await sleep(350); };
        // GE_TRACE=1: every frame for 1.5 s from the click, the strip's scroll (and goal) and every other group's chip box.
        const trace = () => process.env.GE_TRACE && ui.evaluate(({ gid, strip }) => { const rows = window.__geTrace = [], t0 = performance.now(); const step = () => { const node = [...document.querySelectorAll(strip)].find(n => n.getClientRects().length && !n.closest('[inert]')); const chips = [...document.querySelectorAll('.tab-group-badge,.sb-group-header[data-group-header]')].filter(n => (n.dataset.groupId || n.dataset.groupHeader) !== gid && !n.closest('[inert]')).map(n => { const b = n.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; }); rows.push([Math.round(performance.now() - t0), node ? Math.round(node.scrollLeft) : null, node?.dataset.scrollGoal ?? '', JSON.stringify(chips)]); if (performance.now() - t0 < 1500) requestAnimationFrame(step); }; requestAnimationFrame(step); }, { gid, strip: stripSel[layout] });
        try { await row(MOVE_ROW); await trace(); await row('New tab group'); }
        catch (error) { const rows = await o.locator('[role=menuitem]').allInnerTexts().catch(() => []); results.push({ label: `${tag}-${via}`, pass: false, bad: ['menu rows: ' + String(error.message).split('\n')[0].slice(0, 120) + ' (rows: ' + rows.map(r => r.replace(/\s+/g, ' ').trim()).join(' | ').slice(0, 300) + ')'] }); await closePopup(); continue; }
        if (process.env.GE_TRACE) { await sleep(1300); log('trace', `${tag}-${via}`, JSON.stringify(await ui.evaluate(() => window.__geTrace.filter((row, i, all) => i === 0 || row.slice(1).join() !== all[i - 1].slice(1).join())))); }
        s = await snap(); const created = s.tabGroups.find(g => g.id !== gid);
        if (!created) { results.push({ label: `${tag}-${via}`, pass: false, bad: ['no group created'] }); await closePopup(); continue; }
        await judge(`${tag}-${via}`, layout, created.id, k);
      }
    }
  } finally {
    clearTimeout(watchdog);
    try { await app?.close(); } catch {}
  }
});
await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter(r => !r.pass);
log(`${results.length - failed.length}/${results.length} passed; evidence ${OUT}`);
process.exit(failed.length ? 1 : 0);
