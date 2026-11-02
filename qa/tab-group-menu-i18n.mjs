// The tab menu and the tab-group menu in other languages: every row is in the active language (no English left from the
// literals this file once had), the focus-restore after drilling into a section and coming back with ArrowLeft lands on the
// row it came from, and a clip/overlap scan of the panel finds 0 hits. Real app, one native slot, isolated profile, hidden
// window shown inactive (no focus, no OS cursor: synthetic CDP input into the app's own pages only).
// Per language x interface scale x theme it opens: the tab menu on a loose tab, Move to tab group > (ArrowLeft), Move to
// workspace > (ArrowLeft), the tab menu on a grouped tab, the group menu from the chip, its Close group… section
// (ArrowLeft), the group's colour swatches, the collapsed group menu, and creates a group (its default name).
// Usage (worktree root, TypeScript import of the formatter, so run it with tsx):
//   node <tsx cli> qa/tab-group-menu-i18n.mjs [outDir]     env TG_LANGS=de,ru  TG_SCALES=100,150  TG_THEMES=light,dark
// Evidence: one montage PNG per case (the panels side by side) + results.json. Exit 1 when any check fails.
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
import { withSlot } from './native-slot.mjs';
import { format } from '../src/i18n/format.ts';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.resolve(process.argv[2] || (process.platform==='win32'?'C:/ae/tg-i18n':'qa/artifacts/tg-i18n')); await fs.mkdir(OUT, { recursive: true });
const LANGS = (process.env.TG_LANGS || 'de,ru').split(','), SCALES = (process.env.TG_SCALES || '100,150').split(',').map(Number), THEMES = (process.env.TG_THEMES || 'light,dark').split(',');
const catalogs = {}; for (const code of ['en', ...LANGS]) catalogs[code] = JSON.parse(readFileSync(`src/i18n/${code}.json`, 'utf8'));
const tr = (lang, id, params) => format(lang, catalogs[lang][id] ?? catalogs.en[id], params);
/** The English literals this menu used to carry: none may show in another language. */
const OLD_ENGLISH = ['Move to tab group', 'New tab group', 'Remove from group', 'Group actions', 'Tab actions', 'Cancel', 'New tab in group', 'Copy links', 'Rename', 'Expand group', 'Collapse group', 'Ungroup tabs', 'Close group…', 'Close other tabs', 'Close tabs to the left', 'Close tabs to the right', 'Close 2 tabs'];
const results = [];
const log = (...a) => console.log('[tg-i18n]', ...a);

await withSlot('tab-group-menu-i18n', async () => {
  let app;
  const watchdog = setTimeout(() => { log('watchdog: closing'); void app?.close().catch(() => {}); }, 20 * 60_000); watchdog.unref();
  try {
    app = await launchPreparedNative({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [path.resolve(process.env.D_APP_MAIN||'desktop/main.cjs')],
      env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: path.resolve(`.qa-profiles/tg-i18n-${Date.now()}`), ACIRA_BROWSER_TEST_HIDDEN: '1' },
      timeout: 60000,
    });
    const pick = async test => { for (let i = 0; i < 300; i++) { for (const p of app.windows()) { try { if (test(p.url())) return p; } catch {} } await sleep(100); } throw Error('page not found'); };
    let ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
    try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 15000 }); } catch {}
    await sleep(1200); ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
    const overlay = () => pick(u => u.startsWith('acira-browser-ui://ui/index.html?view=overlay'));
    const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
    const snap = () => ui.evaluate(() => window.acira.getSnapshot());
    for (let i = 0; i < 5; i++) await act({ type: 'tab.new' });
    await sleep(600);
    const display = await app.evaluate(({ screen }) => { const all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay(), d = all.find(d => d.id !== primary.id) || primary; return { x: d.workArea.x, y: d.workArea.y, w: d.workArea.width, h: d.workArea.height }; });
    const setBounds = (width, height) => app.evaluate(({ BaseWindow }, b) => { const w = BaseWindow.getAllWindows().sort((a, c) => c.getBounds().width - a.getBounds().width)[0]; const at = { x: b.x + 30, y: b.y + 30, width: b.width, height: b.height }; w.setBounds(at); w.setBounds(at); if(process.platform==='darwin'){for(const child of w.contentView.children)child.webContents?.setBackgroundThrottling(false);}else if (!w.isVisible()) w.showInactive(); return w.getContentBounds(); }, { width, height, x: display.x, y: display.y });
    const zooms = () => app.evaluate(({ BaseWindow, webContents }) => {
      const win = BaseWindow.getAllWindows().sort((a, c) => c.getBounds().width - a.getBounds().width)[0], all = webContents.getAllWebContents();
      const ov = all.find(w => w.getURL().includes('?view=overlay'));
      return { overlay: ov?.getZoomFactor() || 1, content: win.getContentBounds() };
    });
    /** The panel in window DIPs (the overlay view sits inside a clip view). */
    const panel = async () => {
      const host = await app.evaluate(({ BaseWindow }) => {
        const win = BaseWindow.getAllWindows().sort((a, c) => c.getBounds().width - a.getBounds().width)[0];
        for (const view of win.contentView.children) for (const child of view.children || []) if (child.webContents?.getURL().includes('?view=overlay')) return { visible: view.getVisible(), box: view.getBounds(), inner: child.getBounds() };
        return null;
      });
      if (!host?.visible) return null;
      const o = await overlay(), z = await zooms();
      const r = await o.evaluate(() => { const n = document.querySelector('.browser-popup'); if (!n) return null; const b = n.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; });
      if (!r) return null;
      const ox = host.box.x + host.inner.x, oy = host.box.y + host.inner.y, k = z.overlay;
      return { left: ox + r.left * k, top: oy + r.top * k, right: ox + r.right * k, bottom: oy + r.bottom * k, content: z.content };
    };
    // The panel once it has stopped moving (its box is the same twice, 300 ms apart).
    const waitPanel = async () => { let last = null; for (let i = 0; i < 40; i++) { const p = await panel(); if (p && p.right - p.left > 40 && p.bottom - p.top > 20) { if (last && ['left', 'top', 'right', 'bottom'].every(k => Math.abs(p[k] - last[k]) < 1)) return p; last = p; await sleep(300); } else await sleep(120); } return last; };
    const closePopup = async () => { for (let i = 0; i < 5; i++) { if (!await panel()) break; try { const o = await overlay(); await o.keyboard.press('Escape'); } catch {} await sleep(350); } await sleep(250); };
    /** The panel's pixels: every view of the window back to front, cropped to the panel plus a margin (the hidden window has no OS capture). */
    const grab = async (p) => {
      const parts = await app.evaluate(async ({ BaseWindow }) => {
        const win = BaseWindow.getAllWindows().sort((a, c) => c.getBounds().width - a.getBounds().width)[0], out = [];
        const walk = async (view, ox, oy, clip) => {
          for (const child of view.children || []) {
            if (!child.getVisible()) continue;
            const b = child.getBounds(), x = ox + b.x, y = oy + b.y;
            const c = { x: Math.max(clip.x, x), y: Math.max(clip.y, y), r: Math.min(clip.r, x + b.width), b: Math.min(clip.b, y + b.height) };
            if (c.r <= c.x || c.b <= c.y) continue;
            if (child.webContents && !child.webContents.isDestroyed()) { const img = await child.webContents.capturePage(); if (!img.isEmpty()) out.push({ url: img.toDataURL(), ratio: img.getSize().width / b.width, sx: c.x - x, sy: c.y - y, x: c.x, y: c.y, w: c.r - c.x, h: c.b - c.y }); }
            await walk(child, x, y, c);
          }
        };
        const cb = win.getContentBounds(); await walk(win.contentView, 0, 0, { x: 0, y: 0, r: cb.width, b: cb.height });
        return { parts: out, width: cb.width, height: cb.height };
      });
      const m = 14, crop = { x: Math.max(0, Math.floor(p.left - m)), y: Math.max(0, Math.floor(p.top - m)) };
      crop.w = Math.max(1, Math.min(parts.width, Math.ceil(p.right + m)) - crop.x); crop.h = Math.max(1, Math.min(parts.height, Math.ceil(p.bottom + m)) - crop.y);
      return ui.evaluate(async ({ parts, crop }) => {
        const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
        const c = new OffscreenCanvas(crop.w, crop.h), g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, c.width, c.height);
        for (const q of parts.parts) g.drawImage(await load(q.url), q.sx * q.ratio, q.sy * q.ratio, q.w * q.ratio, q.h * q.ratio, q.x - crop.x, q.y - crop.y, q.w, q.h);
        const blob = await c.convertToBlob({ type: 'image/png' }), bytes = new Uint8Array(await blob.arrayBuffer());
        let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return 'data:image/png;base64,' + btoa(s);
      }, { parts, crop });
    };
    /** The clip/overlap scan of the panel in the overlay page (CSS px). */
    const scan = async () => {
      const o = await overlay();
      return o.evaluate(() => {
        const hits = [], notes = [], pop = document.querySelector('.browser-popup');
        if (!pop) return { hits: ['no popup'], rows: [], notes };
        const shown = n => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && !n.closest('[inert],[aria-hidden=true]');
        const pb = pop.getBoundingClientRect(), name = n => (n.className && String(n.className).split(' ')[0]) || n.tagName.toLowerCase();
        if (pb.left < -0.5 || pb.top < -0.5 || pb.right > innerWidth + 0.5 || pb.bottom > innerHeight + 0.5) hits.push(`panel outside the window: ${[pb.left, pb.top, pb.right, pb.bottom].map(Math.round)} in ${innerWidth}x${innerHeight}`);
        for (const n of pop.querySelectorAll('*')) {
          if (!shown(n)) continue; const cs = getComputedStyle(n), b = n.getBoundingClientRect(); if (!b.width || !b.height) continue;
          const clips = x => x === 'hidden' || x === 'clip';
          if (clips(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) hits.push(`clipped width: ${name(n)} "${(n.textContent || '').trim().slice(0, 40)}" ${n.scrollWidth}>${n.clientWidth}`);
          if (clips(cs.overflowY) && n.scrollHeight > n.clientHeight + 1 && n !== pop) hits.push(`clipped height: ${name(n)} "${(n.textContent || '').trim().slice(0, 40)}" ${n.scrollHeight}>${n.clientHeight}`);
          if (/auto|scroll/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) hits.push(`menu scrolls (rows cut off): ${name(n)} ${n.scrollHeight}>${n.clientHeight}`);
        }
        const rows = [...pop.querySelectorAll('[role=menuitem], .menu-row, .menu-form-trigger')].filter(shown);
        const seen = new Set(), list = rows.filter(r => !seen.has(r) && seen.add(r));
        list.forEach((r, i) => {
          const rb = r.getBoundingClientRect(), text = (r.textContent || '').trim();
          if (rb.left < pb.left - 1 || rb.right > pb.right + 1 || rb.top < pb.top - 1 || rb.bottom > pb.bottom + 1) hits.push(`row outside the panel: "${text}"`);
          const next = list[i + 1]; if (next) { const nb = next.getBoundingClientRect(); if (nb.top < rb.bottom - 1.5 && nb.bottom > rb.top + 1.5 && Math.abs(nb.left - rb.left) < 4) hits.push(`rows overlap: "${text}" / "${(next.textContent || '').trim()}"`); }
          const kids = [...r.children].filter(shown).map(k => ({ k, b: k.getBoundingClientRect() }));
          for (let a = 0; a < kids.length; a++) for (let c = a + 1; c < kids.length; c++) { const A = kids[a].b, B = kids[c].b; if (Math.min(A.right, B.right) - Math.max(A.left, B.left) > 1.5 && Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 1.5) hits.push(`row parts overlap in "${text}": ${name(kids[a].k)} / ${name(kids[c].k)}`); }
          const range = document.createRange();
          for (const span of r.querySelectorAll('span')) { range.selectNodeContents(span); for (const q of range.getClientRects()) if (q.width && (q.right > rb.right + 0.5 || q.left < rb.left - 0.5)) { hits.push(`text leaves its row: "${text}"`); break; } }
          const lh = parseFloat(getComputedStyle(r).lineHeight) || 18; if (rb.height > lh * 1.9) notes.push(`wraps (${Math.round(rb.height)}px): "${text}"`);
        });
        // The width the widest row would need to show untruncated (label's natural width, icon, shortcut, gaps, paddings), in CSS px.
        let need = 0; for (const r of list) { const cs = getComputedStyle(r), kids = [...r.children].filter(k => k.getClientRects().length); let sum = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + Math.max(0, kids.length - 1) * (parseFloat(cs.columnGap) || 0); for (const k of kids) sum += k.tagName === 'SPAN' ? k.scrollWidth : k.getBoundingClientRect().width; need = Math.max(need, sum); }
        const pc = getComputedStyle(pop); need += parseFloat(pc.paddingLeft) + parseFloat(pc.paddingRight) + parseFloat(pc.borderLeftWidth) + parseFloat(pc.borderRightWidth);
        return { need: Math.ceil(need), hits, notes, rows: list.map(r => (r.textContent || '').trim()), label: pop.querySelector('[role=menu]')?.getAttribute('aria-label') || null, width: Math.round(pb.width), height: Math.round(pb.height) };
      });
    };
    const focusRow = async (label, { prefix = false } = {}) => { const o = await overlay(); return o.evaluate(({ label, prefix }) => { const n = [...document.querySelectorAll('[role=menuitem], .menu-form-trigger')].find(n => prefix ? (n.textContent || '').trim().startsWith(label) : (n.textContent || '').trim() === label); n?.focus({ preventScroll: true }); return !!n && document.activeElement === n; }, { label, prefix }); };
    const active = async () => { const o = await overlay(); return o.evaluate(() => (document.activeElement?.textContent || '').trim()); };
    const rect = (sel, id) => ui.evaluate(({ sel, id }) => { const n = [...document.querySelectorAll(sel)].find(n => (n.dataset.tabId === id || n.dataset.groupId === id) && !n.closest('[inert]') && n.getClientRects().length); if (!n) return null; n.scrollIntoView({ inline: 'center', block: 'nearest' }); const b = n.getBoundingClientRect(); return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 }; }, { sel, id });

    for (const lang of LANGS) for (const scale of SCALES) for (const theme of THEMES) {
      const needs = {}, tag = `${lang}-${scale}-${theme}`, T = (id, p) => tr(lang, id, p), fails = [], oks = [], crops = [];
      const check = (cond, msg) => { if (!cond) fails.push(msg); else oks.push(msg); };
      const step = async (name, extra = {}) => {
        const p = await waitPanel(); if (!p) { fails.push(`${name}: no panel`); return null; }
        const s = await scan(); const crop = await grab(p); crops.push({ name, url: crop });
        for (const h of s.hits) fails.push(`${name}: ${h}`);
        if (lang !== 'en') for (const row of [...s.rows, s.label || '']) if (OLD_ENGLISH.includes(row)) fails.push(`${name}: still English "${row}"`);
        if (extra.rows) for (const want of extra.rows) check(s.rows.some(r => r === want || r.startsWith(want)), `${name}: has row "${want}"`);
        if (s.notes.length) oks.push(`${name}: ${s.notes.join('; ')}`);
        oks.push(`${name}: ${s.width}x${s.height}css need ${s.need}px [${s.rows.join(' | ')}]`); needs[name] = s.need;
        return s;
      };
      log('case', tag);
      try {
        await act({ type: 'settings.update', patch: { interfaceScale: scale, appearance: theme, language: lang, verticalTabs: false, windowView: 'full' } });
        await sleep(1800); ui = await pick(u => u === 'acira-browser-ui://ui/index.html'); await setBounds(1280, 760); await sleep(900);
        check(await ui.evaluate(() => document.documentElement.lang) === lang || (await ui.evaluate(() => document.documentElement.lang)).startsWith(lang.split('-')[0]), `page language is ${lang}`);
        let s = await snap(); for (const g of s.tabGroups) await act({ type: 'tab.group.remove', id: g.id });
        s = await snap(); const ids = s.tabs.map(t => t.id);
        await act({ type: 'tab.group.create', tabId: ids[0], name: 'Reading', color: 'green' }); s = await snap(); const gid = s.tabGroups.at(-1).id;
        await act({ type: 'tab.group.assign', tabIds: [ids[1]], groupId: gid });
        await act({ type: 'tab.select', id: ids.at(-1) }); await sleep(900);

        // 1. The tab menu on a loose tab, then Move to tab group > and back.
        let at = await rect('.browser-tab[data-tab-id]', ids[3]); if (!at) throw Error('no loose tab on screen');
        await ui.mouse.click(at.x, at.y, { button: 'right' });
        await step('tab-menu', { rows: [T('tabgroupcontrols.moveToTabGroup'), T('app.closeTab'), T('shortcutCmd.close-other-tabs'), T('app.closeTabsLeft'), T('shortcutCmd.close-tabs-right')] });
        check(await focusRow(T('tabgroupcontrols.moveToTabGroup')), 'Move to tab group row focusable');
        let o = await overlay(); await o.keyboard.press('ArrowRight'); await sleep(450);
        await step('move-to-group', { rows: [T('app.tabActions'), 'Reading', T('tabgroupcontrols.newTabGroup')] });
        await o.keyboard.press('ArrowLeft'); await sleep(450);
        check(await active() === T('tabgroupcontrols.moveToTabGroup'), `ArrowLeft from Move to tab group focuses "${T('tabgroupcontrols.moveToTabGroup')}" (got "${await active()}")`);
        // Move to workspace > and back (offered when the window has workspaces).
        if (await focusRow(T('workspaces.moveTo'))) {
          await o.keyboard.press('ArrowRight'); await sleep(450); await step('move-to-workspace', { rows: [T('app.tabActions')] });
          await o.keyboard.press('ArrowLeft'); await sleep(450);
          check(await active() === T('workspaces.moveTo'), `ArrowLeft from Move to workspace focuses "${T('workspaces.moveTo')}" (got "${await active()}")`);
        } else oks.push('no Move to workspace row in this window');
        // New tab group from the menu: the default group name is in the language.
        check(await focusRow(T('tabgroupcontrols.moveToTabGroup')), 'Move to tab group focusable again');
        await o.keyboard.press('ArrowRight'); await sleep(450);
        const before = (await snap()).tabGroups.length;
        check(await focusRow(T('tabgroupcontrols.newTabGroup')), 'New tab group row focusable'); await o.keyboard.press('Enter'); await sleep(1100);
        const made = (await snap()).tabGroups; const fresh = made.find(g => g.id !== gid);
        check(made.length === before + 1 && fresh?.name === T('tabgroupcontrols.newGroup'), `new group is named "${T('tabgroupcontrols.newGroup')}" (got "${fresh?.name}")`);
        await closePopup(); if (fresh) await act({ type: 'tab.group.remove', id: fresh.id }); await sleep(400);

        // 2. The tab menu on a grouped tab: Remove from group.
        at = await rect('.browser-tab[data-tab-id]', ids[1]); if (!at) throw Error('no grouped tab on screen');
        await ui.mouse.click(at.x, at.y, { button: 'right' });
        await step('grouped-tab-menu', { rows: [T('acirasidebar.splitRemoveFromGroup'), T('tabgroupcontrols.moveToTabGroup')] });
        await closePopup();

        // 3. The group menu from the chip, its Close group… section and back.
        at = await rect('.tab-group-badge', gid); if (!at) throw Error('no group chip on screen');
        check(await ui.evaluate(({ gid }) => document.querySelector(`.tab-group-badge[data-group-id="${gid}"]`)?.getAttribute('aria-label'), { gid }) === T('tabgroupcontrols.collapseNamedGroup', { group: 'Reading', count: 2 }), 'chip label is the translated "collapse" label');
        await ui.mouse.click(at.x, at.y, { button: 'right' });
        await step('group-menu', { rows: [T('main.edit') + ' Reading', T('acirasidebar.newTabInGroup'), T('tabgroupcontrols.copyLinks'), T('acirasidebar.splitRename'), T('tabgroupcontrols.collapseGroup'), T('tabgroupcontrols.ungroupTabs'), T('tabgroupcontrols.closeGroup')] });
        o = await overlay();
        check(await focusRow(T('tabgroupcontrols.closeGroup')), 'Close group… row focusable'); await o.keyboard.press('Enter'); await sleep(450);
        await step('close-group', { rows: [T('tabgroupcontrols.closeTabsN', { count: 2 }), T('dialog.cancel')] });
        await o.keyboard.press('ArrowLeft'); await sleep(450);
        check(await active() === T('tabgroupcontrols.closeGroup'), `ArrowLeft from Close group focuses "${T('tabgroupcontrols.closeGroup')}" (got "${await active()}")`);
        // The colour swatches in the group editor flyout.
        if (await focusRow(T('main.edit') + ' Reading', { prefix: true })) {
          await o.keyboard.press('Enter'); await sleep(900);
          const labels = await o.evaluate(() => [...document.querySelectorAll('.group-color-swatch')].map(n => [n.getAttribute('aria-label') || '', n.getAttribute('title') || '']));
          check(labels.length === 10, `editor shows 10 colour swatches (got ${labels.length})`);
          if (labels.length) { const want = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'].map(c => T('workspaces.color' + c[0].toUpperCase() + c.slice(1))); check(want.every(w => labels.some(([, title]) => title === w)), `swatch titles are the translated colour names (${labels.map(l => l[1]).join(', ')})`); check(labels.every(([a]) => !/group color/i.test(a) || lang === 'en'), `swatch labels are not English (${labels.map(l => l[0]).slice(0, 3).join(' | ')} …)`); }
          const p = await waitPanel(); if (p) { const g = await scan(); for (const h of g.hits) fails.push(`group-editor: ${h}`); crops.push({ name: 'group-editor', url: await grab(p) }); }
        }
        await closePopup();

        // 4. Collapsed: the group menu offers Expand group, and the chip label says expand.
        await act({ type: 'tab.group.update', id: gid, patch: { collapsed: true } }); await sleep(900);
        at = await rect('.tab-group-badge', gid); if (!at) throw Error('no collapsed chip');
        const chip = await ui.evaluate(({ gid }) => { const n = document.querySelector(`.tab-group-badge[data-group-id="${gid}"]`); return { label: n?.getAttribute('aria-label'), count: n?.querySelector('small')?.textContent }; }, { gid });
        check(chip.label === T('tabgroupcontrols.expandNamedGroup', { group: 'Reading', count: Number(chip.count) }), `collapsed chip label is "${T('tabgroupcontrols.expandNamedGroup', { group: 'Reading', count: Number(chip.count) })}" (got "${chip.label}")`);
        await ui.mouse.click(at.x, at.y, { button: 'right' });
        await step('group-menu-collapsed', { rows: [T('tabgroupcontrols.expandGroup')] });
        await closePopup(); await act({ type: 'tab.group.update', id: gid, patch: { collapsed: false } }); await sleep(500);
      } catch (error) { fails.push('case error: ' + String(error.message).split('\n')[0]); await closePopup().catch(() => {}); }
      // The case's panels side by side.
      if (crops.length) {
        const png = await ui.evaluate(async ({ crops, title }) => {
          const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
          const imgs = await Promise.all(crops.map(c => load(c.url))), head = 20, gap = 8;
          const w = imgs.reduce((a, i) => a + i.width + gap, gap), h = Math.max(...imgs.map(i => i.height)) + head + gap;
          const c = new OffscreenCanvas(w, h), g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '12px sans-serif';
          g.fillText(title, gap, 14); let x = gap; imgs.forEach((i, n) => { g.drawImage(i, x, head); g.fillStyle = '#fff'; g.fillText(crops[n].name, x + 2, 14 + 0); x += i.width + gap; });
          const blob = await c.convertToBlob({ type: 'image/png' }), bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s);
        }, { crops, title: tag });
        await fs.writeFile(path.join(OUT, tag + '.png'), Buffer.from(png, 'base64'));
      }
      results.push({ tag, pass: !fails.length, fails, oks, needs });
      log('need', tag, JSON.stringify(needs));
      log(fails.length ? 'FAIL' : 'PASS', tag, ...fails);
    }
  } finally {
    clearTimeout(watchdog);
    try { await app?.close(); } catch {}
  }
});
await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter(r => !r.pass);
log(`${results.length - failed.length}/${results.length} cases passed; evidence ${OUT}`);
process.exit(failed.length ? 1 : 0);
