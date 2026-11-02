// The other compact menus in every language: the page's right-click menu (plain page, link, image, video, selection, editable),
// the tab strip's blank-area menu, the toolbar menu, the bookmark menu, the split card menu (and its two sections), the
// workspace menu, the group preview and the extensions panel. Each is opened in the real app (isolated profile, one native
// slot, window shown inactive, synthetic input into the app's own pages only), and checked for clipped or overlapping text,
// panel/row geometry, and untranslated English (a row that is an English catalog string a language translates differently, or
// Latin words in a non-Latin language). It also prints the width each kind's widest row needs (CSS px) to calibrate
// CONTEXT_MENU_WIDTH in src/ui/popup.ts.
// Usage (worktree root, run with tsx):  node <tsx cli> qa/context-menus-i18n.mjs [outDir]
//   env CM_LANGS=de,ru  CM_COMBOS=100:dark,150:light  CM_ONLY=<regex on the menu name>
// Evidence: one montage PNG per case + results.json. Exit 1 when any check fails.
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
import { withSlot } from './native-slot.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.resolve(process.argv[2] || (process.platform==='win32'?'C:/ae/cm-i18n':'qa/artifacts/cm-i18n')); await fs.mkdir(OUT, { recursive: true });
const ALL = ['en', 'de', 'es', 'fr', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi'];
const LANGS = (process.env.CM_LANGS || ALL.join(',')).split(','), COMBOS = (process.env.CM_COMBOS || '100:dark,150:light').split(',').map(c => c.split(':'));
const ONLY = process.env.CM_ONLY ? new RegExp(process.env.CM_ONLY, 'i') : null;
const catalogs = {}; for (const code of ALL) catalogs[code] = JSON.parse(readFileSync(`src/i18n/${code}.json`, 'utf8'));
const NON_LATIN = new Set(['ja', 'zh-CN', 'ar', 'ru', 'ko', 'hi']);
const ALLOWED_LATIN = /^(Acira|Tor|PDF|Windows|macOS|Google|DuckDuckGo|Bing|Peek|URL|VPN|Ctrl|Shift|Alt|Enter|Esc|Tab|F\d+|Engine|Reading|Home|HTTPS|DNS|AI|ID|Mac|Chrome|Firefox|Edge|Arc|Brave)$/i;
const results = [];
const log = (...a) => console.log('[cm-i18n]', ...a);

// A page with every right-click target, served from localhost.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/i.png')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
  if (req.url.startsWith('/v.mp4')) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>Menu target</title><body style="margin:0;font:16px sans-serif"><p style="margin:20px"><a id="link" href="/other">A link to right-click</a></p><p style="margin:20px"><img id="img" src="/i.png" width="120" height="60" style="background:#ccc"></p><p style="margin:20px"><video id="video" src="/v.mp4" width="240" height="80" controls style="background:#444"></video></p><p id="text" style="margin:20px">12345 67890</p><p style="margin:20px"><textarea id="edit" rows="2" cols="30">hello world</textarea></p><div id="plain" style="height:240px"></div></body>');
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const PAGE = `http://127.0.0.1:${server.address().port}/`;

await withSlot('context-menus-i18n', async () => {
  let app;
  const watchdog = setTimeout(() => { log('watchdog: closing'); void app?.close().catch(() => {}); }, 55 * 60_000); watchdog.unref();
  try {
    app = await launchPreparedNative({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [path.resolve(process.env.D_APP_MAIN||'desktop/main.cjs')],
      env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: path.resolve(`.qa-profiles/cm-i18n-${Date.now()}`), ACIRA_BROWSER_TEST_HIDDEN: '1' },
      timeout: 60000,
    });
    const pick = async test => { for (let i = 0; i < 300; i++) { for (const p of app.windows()) { try { if (test(p.url())) return p; } catch {} } await sleep(100); } throw Error('page not found'); };
    let ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
    try { await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 15000 }); } catch {}
    await sleep(1200); ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
    const overlay = () => pick(u => u.startsWith('acira-browser-ui://ui/index.html?view=overlay'));
    const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
    const snap = () => ui.evaluate(() => window.acira.getSnapshot());
    const command = c => ui.evaluate(c => window.acira.browserCommand(c), c);
    for (let i = 0; i < 5; i++) await act({ type: 'tab.new' });
    await sleep(600);
    const display = await app.evaluate(({ screen }) => { const all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay(), d = all.find(d => d.id !== primary.id) || primary; return { x: d.workArea.x, y: d.workArea.y }; });
    const setBounds = (width, height) => app.evaluate(({ BaseWindow }, b) => { const w = BaseWindow.getAllWindows().sort((a, c) => c.getBounds().width - a.getBounds().width)[0]; const at = { x: b.x + 30, y: b.y + 30, width: b.width, height: b.height }; w.setBounds(at); w.setBounds(at); if(process.platform==='darwin'){for(const child of w.contentView.children)child.webContents?.setBackgroundThrottling(false);}else if (!w.isVisible()) w.showInactive(); return w.getContentBounds(); }, { width, height, x: display.x, y: display.y });
    const zooms = () => app.evaluate(({ BaseWindow, webContents }) => {
      const win = BaseWindow.getAllWindows().sort((a, c) => c.getBounds().width - a.getBounds().width)[0], ov = webContents.getAllWebContents().find(w => w.getURL().includes('?view=overlay'));
      return { overlay: ov?.getZoomFactor() || 1, content: win.getContentBounds() };
    });
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
      return { left: ox + r.left * k, top: oy + r.top * k, right: ox + r.right * k, bottom: oy + r.bottom * k };
    };
    const waitPanel = async () => { let last = null; for (let i = 0; i < 40; i++) { const p = await panel(); if (p && p.right - p.left > 40 && p.bottom - p.top > 20) { if (last && ['left', 'top', 'right', 'bottom'].every(k => Math.abs(p[k] - last[k]) < 1)) return p; last = p; await sleep(300); } else await sleep(120); } return last; };
    const closePopup = async () => { for (let i = 0; i < 5; i++) { if (!await panel()) break; try { const o = await overlay(); await o.keyboard.press('Escape'); } catch {} await sleep(350); } await sleep(250); };
    const grab = async p => {
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
    const scan = async () => {
      const o = await overlay();
      return o.evaluate(() => {
        const hits = [], notes = [], pop = document.querySelector('.browser-popup');
        if (!pop) return { hits: ['no popup'], labels: [], notes };
        const shown = n => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && !n.closest('[inert],[aria-hidden=true]');
        const pb = pop.getBoundingClientRect(), name = n => (n.className && String(n.className).split(' ')[0]) || n.tagName.toLowerCase();
        if (pb.left < -0.5 || pb.top < -0.5 || pb.right > innerWidth + 0.5 || pb.bottom > innerHeight + 0.5) hits.push(`panel outside the window: ${[pb.left, pb.top, pb.right, pb.bottom].map(Math.round)} in ${innerWidth}x${innerHeight}`);
        const limited = pb.top < 14 || pb.bottom > innerHeight - 14 || pb.height >= innerHeight - 40;
        for (const n of pop.querySelectorAll('*')) {
          if (!shown(n)) continue; const cs = getComputedStyle(n), b = n.getBoundingClientRect(); if (!b.width || !b.height) continue;
          const clips = x => x === 'hidden' || x === 'clip';
          if (clips(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) hits.push(`clipped width: ${name(n)} "${(n.textContent || '').trim().slice(0, 40)}" ${n.scrollWidth}>${n.clientWidth}`);
          if (clips(cs.overflowY) && n.scrollHeight > n.clientHeight + 1 && n !== pop) hits.push(`clipped height: ${name(n)} "${(n.textContent || '').trim().slice(0, 40)}" ${n.scrollHeight}>${n.clientHeight}`);
          // A menu taller than the room the window gives it scrolls by design (its panel then reaches the window's edges); anything else that scrolls is a cut-off menu.
          if (/auto|scroll/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) (limited ? notes : hits).push(`menu scrolls${limited ? ' (limited by the window)' : ' (rows cut off)'}: ${name(n)} ${n.scrollHeight}>${n.clientHeight}`);
        }
        const rows = [...new Set([...pop.querySelectorAll('[role^=menuitem], .menu-row, .menu-form-trigger')].filter(shown))];
        rows.forEach((r, i) => {
          const rb = r.getBoundingClientRect(), text = (r.textContent || '').trim();
          if (rb.left < pb.left - 1 || rb.right > pb.right + 1) hits.push(`row outside the panel: "${text}"`);
          else if ((rb.top < pb.top - 1 || rb.bottom > pb.bottom + 1) && !limited) hits.push(`row outside the panel: "${text}"`);
          const next = rows[i + 1]; if (next) { const nb = next.getBoundingClientRect(); if (nb.top < rb.bottom - 1.5 && nb.bottom > rb.top + 1.5 && Math.abs(nb.left - rb.left) < 4) hits.push(`rows overlap: "${text}" / "${(next.textContent || '').trim()}"`); }
          const kids = [...r.children].filter(shown).map(k => ({ k, b: k.getBoundingClientRect() }));
          for (let a = 0; a < kids.length; a++) for (let c = a + 1; c < kids.length; c++) { const A = kids[a].b, B = kids[c].b; if (Math.min(A.right, B.right) - Math.max(A.left, B.left) > 1.5 && Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 1.5) hits.push(`row parts overlap in "${text}": ${name(kids[a].k)} / ${name(kids[c].k)}`); }
          const range = document.createRange();
          for (const span of r.querySelectorAll('span')) { range.selectNodeContents(span); for (const q of range.getClientRects()) if (q.width && (q.right > rb.right + 0.5 || q.left < rb.left - 0.5)) { hits.push(`text leaves its row: "${text}"`); break; } }
          // A label that fits by less than 2px would clip with another font rendering: the width has to leave some room.
          for (const span of r.querySelectorAll('span')) { if (getComputedStyle(span).whiteSpace !== 'nowrap' || getComputedStyle(span).overflow !== 'hidden' || !span.clientWidth || span.scrollWidth > span.clientWidth + 1) continue; range.selectNodeContents(span); const nat = Math.max(0, ...[...range.getClientRects()].map(q => q.width)); if (nat && span.clientWidth - nat < 2) hits.push(`tight: "${(span.textContent || '').trim()}" has ${(span.clientWidth - nat).toFixed(1)}px spare`); }
          const lh = parseFloat(getComputedStyle(r).lineHeight) || 18; if (rb.height > lh * 1.9) notes.push(`wraps (${Math.round(rb.height)}px): "${text}"`);
        });
        let need = 0; for (const r of rows) { const cs = getComputedStyle(r), kids = [...r.children].filter(k => k.getClientRects().length); let sum = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + Math.max(0, kids.length - 1) * (parseFloat(cs.columnGap) || 0); for (const k of kids) sum += k.tagName === 'SPAN' ? (k.scrollWidth > k.clientWidth + 1 ? k.scrollWidth : Math.max(...[...(() => { const g = document.createRange(); g.selectNodeContents(k); return g.getClientRects(); })()].map(q => q.width), 0) || k.scrollWidth) : k.getBoundingClientRect().width; need = Math.max(need, sum); }
        const pc = getComputedStyle(pop); need += parseFloat(pc.paddingLeft) + parseFloat(pc.paddingRight) + parseFloat(pc.borderLeftWidth) + parseFloat(pc.borderRightWidth);
        // Every visible piece of text of the panel (not only rows), for the English check.
        const texts = [...new Set([...pop.querySelectorAll('span, button, label, strong, h2, p, small, a, [title]')].filter(shown).flatMap(n => [n.children.length === 0 ? (n.textContent || '').trim() : '', n.getAttribute('title') || '', n.getAttribute('aria-label') || '']).filter(Boolean))];
        return { need: Math.ceil(need), hits, notes, texts, labels: rows.map(r => ((r.querySelector('span') || r).textContent || '').trim()), width: Math.round(pb.width), height: Math.round(pb.height) };
      });
    };
    const rightClick = async (selector, which = 'first') => {
      const at = await ui.evaluate(({ selector }) => { const n = [...document.querySelectorAll(selector)].find(n => !n.closest('[inert]') && n.getClientRects().length); if (!n) return null; n.scrollIntoView({ inline: 'center', block: 'nearest' }); const b = n.getBoundingClientRect(); return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2, rect: [b.left, b.top, b.width, b.height] }; }, { selector });
      if (!at) return false; await ui.mouse.click(at.x, at.y, { button: 'right' }); return true;
    };
    const pageClick = (selector, prelude = '') => app.evaluate(async ({ webContents }, { page, selector, prelude }) => {
      const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(page)); if (!wc) return 'no page';
      if (prelude) await wc.executeJavaScript(prelude);
      const r = await wc.executeJavaScript(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;const b=n.getBoundingClientRect();return {x:Math.round(b.left+Math.min(b.width/2,40)),y:Math.round(b.top+Math.min(b.height/2,12))}})()`);
      if (!r) return 'no element';
      wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
      wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'right', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'right', clickCount: 1 });
      return 'ok';
    }, { page: PAGE, selector, prelude });
    const open = (kind, target, anchor) => command({ type: 'ui', tabId: undefined, action: 'open', kind, targetTabId: target, anchor });
    const focusRowText = async prefix => { const o = await overlay(); return o.evaluate(prefix => { const n = [...document.querySelectorAll('[role^=menuitem], .menu-row, .menu-form-trigger')].find(n => ((n.querySelector('span') || n).textContent || '').trim().startsWith(prefix)); n?.focus({ preventScroll: true }); return !!n; }, prefix); };

    let wsMade = false;
    for (const lang of LANGS) for (const [scaleText, theme] of COMBOS) {
      const scale = Number(scaleText), tag = `${lang}-${scale}-${theme}`, own = catalogs[lang], en = catalogs.en;
      const fails = [], oks = [], crops = [], needs = {}, unknown = new Set();
      // The English catalog's strings that this language words differently.
      const englishOnly = new Map(); for (const [id, text] of Object.entries(en)) if (lang !== 'en' && own[id] !== undefined && own[id] !== text && !Object.values(own).includes(text)) englishOnly.set(text, id);
      const ownValues = new Set(Object.values(own));
      const step = async (name, kind) => {
        if (ONLY && !ONLY.test(name)) return null;
        const p = await waitPanel(); if (!p) { fails.push(`${name}: no panel`); return null; }
        const s = await scan(); crops.push({ name, url: await grab(p) });
        for (const h of s.hits) fails.push(`${name}: ${h}`);
        for (const text of s.texts) {
          if (lang === 'en') continue;
          if (englishOnly.has(text)) fails.push(`${name}: still English "${text}"`);
          // A selected website string is payload in the localized search sentence, not browser copy.
          else if (NON_LATIN.has(lang) && (text.replaceAll('A link to right-click', '').match(/[A-Za-z]{3,}/g) || []).some(word => !ALLOWED_LATIN.test(word)) && !ownValues.has(text)) fails.push(`${name}: Latin text in ${lang} "${text.slice(0, 60)}"`);
          else if (!ownValues.has(text) && /[A-Za-z]{3,}/.test(text)) unknown.add(text.slice(0, 70));
        }
        if (s.notes.length) oks.push(`${name}: ${s.notes.join('; ')}`);
        oks.push(`${name}: ${s.width}x${s.height}css need ${s.need}px [${s.labels.join(' | ')}]`);
        needs[kind] = Math.max(needs[kind] || 0, s.need);
        return s;
      };
      log('case', tag);
      try {
        // Only this owned fixture: repeated language-matrix switches are not a reload-loop acceptance test.
        await ui.evaluate(()=>sessionStorage.removeItem('acira-locale-reloads'));
        await act({ type: 'settings.update', patch: { interfaceScale: scale, appearance: theme, language: lang, verticalTabs: false, windowView: 'full' } });
        let settled=false;for(let attempt=0;attempt<200;attempt++){ui=await pick(u=>u==='acira-browser-ui://ui/index.html');try{if(await ui.evaluate(async lang=>document.documentElement.lang===lang&&(await window.acira.getSnapshot()).settings.language===lang,lang)){settled=true;break;}}catch{}await sleep(100);}
        if(!settled)throw Error('Requested language did not settle: '+lang);await setBounds(1280,980);await sleep(900);
        let s = await snap(); for (const g of s.tabGroups) await act({ type: 'tab.group.remove', id: g.id });
        s = await snap(); const ids = s.tabs.filter(t => !t.workspaceId || t.workspaceId === s.activeWorkspaceId).map(t => t.id), active = ids.at(-1);
        await act({ type: 'tab.group.create', tabId: ids[0], name: 'Reading', color: 'green' }); s = await snap(); const gid = s.tabGroups.at(-1).id;
        await act({ type: 'tab.group.assign', tabIds: [ids[1]], groupId: gid });
        await act({ type: 'tab.select', id: active }); await act({ type: 'tab.navigate', url: PAGE, tabId: active });
        await sleep(2200);

        // 1. The page's right-click menu, six targets.
        const variants = [['page', '#plain', ''], ['link', '#link', ''], ['image', '#img', ''], ['video', '#video', ''], ['selection', '#text', "(()=>{const r=document.createRange();r.selectNodeContents(document.getElementById('text'));const s=getSelection();s.removeAllRanges();s.addRange(r);})()"], ['editable', '#edit', "(()=>{getSelection().removeAllRanges();})()"]];
        for (const [name, selector, prelude] of variants) {
          if (ONLY && !ONLY.test('page-' + name)) continue;
          const result = await pageClick(selector, prelude); if (result !== 'ok') { fails.push(`page-${name}: right-click ${result}`); continue; }
          await step('page-' + name, 'page-context'); await closePopup();
        }
        // 2. The tab strip's blank area, the toolbar, the bookmark, the group preview, the extensions panel.
        // (Opened the way the app opens them: the strip's blank-area and the toolbar's menus by their popup kind at a point, the
        // bookmark menu by the bookmarks bar's own window event.)
        if (!ONLY || ONLY.test('strip')) { await command({ type: 'ui', tabId: active, action: 'open', kind: 'strip-context', anchor: { x: 700, y: 20, width: 2, height: 2 } }); await step('strip-context', 'strip-context'); await closePopup(); }
        if (!ONLY || ONLY.test('toolbar')) { await command({ type: 'ui', tabId: active, action: 'open', kind: 'toolbar-context', anchor: { x: 600, y: 70, width: 2, height: 2 } }); await step('toolbar-context', 'toolbar-context'); await closePopup(); }
        if (!ONLY || ONLY.test('bookmark')) { await act({ type: 'bookmark.toggle', url: 'https://example.com/' }); await sleep(500);
          await ui.evaluate(() => window.dispatchEvent(new CustomEvent('acira-study-bookmark-menu', { detail: { url: 'https://example.com/', anchor: { x: 300, y: 80, width: 2, height: 2 } } })));
          await step('bookmark-context', 'bookmark-context'); await closePopup(); }
        if (!ONLY || ONLY.test('extensions')) { const anchor = { x: 900, y: 60, width: 30, height: 30 }; await command({ type: 'ui', tabId: active, action: 'open', kind: 'extensions', anchor }); await step('extensions', 'extensions'); await closePopup(); }
        if (!ONLY || ONLY.test('group-preview')) { await act({ type: 'tab.group.update', id: gid, patch: { collapsed: true } }); await sleep(700);
          const anchor = await ui.evaluate(({ gid }) => { const n = document.querySelector(`.tab-group-badge[data-group-id="${gid}"]`); const b = n?.getBoundingClientRect(); return b && { x: b.left, y: b.top, width: b.width, height: b.height }; }, { gid });
          if (anchor) { await command({ type: 'ui', tabId: active, action: 'open', kind: 'group-preview', targetTabId: ids[0], anchor }); await step('group-preview', 'group-preview'); await closePopup(); } else fails.push('group-preview: no chip');
          await act({ type: 'tab.group.update', id: gid, patch: { collapsed: false } }); await sleep(500); }
        // 3. The split card menu and its sections.
        if (!ONLY || ONLY.test('split')) { await act({ type: 'tab.select', id: ids[2] }); await act({ type: 'split.open', tabIds: [ids[2], ids[3]] }); await sleep(1300);
          const anchor = await ui.evaluate(() => ({ x: 400, y: 60, width: 2, height: 2 }));
          await command({ type: 'ui', tabId: ids[2], action: 'open', kind: 'split-context', targetTabId: ids[2], anchor });
          if (await step('split-context', 'split-context')) {
            const o = await overlay();
            for (const [label, id] of [[null, 'acirasidebar.splitChangeLayout'], [null, 'tabgroupcontrols.moveToTabGroup']]) {
              let focused = false; for (let i = 0; i < 4 && !focused; i++) { focused = await focusRowText(own[id] || en[id]); if (!focused) await sleep(400); }
              if (focused) { await o.keyboard.press('Enter'); await sleep(600); await step('split-' + id.split('.').pop(), 'split-context');
                // (The split menu does not move focus into a section it opens, so put it on the section's first row before going back.)
                await o.evaluate(() => document.querySelector('[role=menuitem]')?.focus()); await o.keyboard.press('ArrowLeft'); await sleep(700); }
              else fails.push(`split-context: no row "${own[id] || en[id]}"`);
            }
          }
          await closePopup(); await act({ type: 'split.separate', tabId: ids[2] }).catch(() => {}); await sleep(600); }
        // 4. The workspace menu: right-click a workspace icon in the sidebar.
        // (A second workspace is made once, then the first is selected again, so the sidebar shows the workspace icons.)
        if (!ONLY || ONLY.test('workspace')) {
          const first = (await snap()).activeWorkspaceId;
          if (!wsMade) { await act({ type: 'workspace.create', name: 'Study', tabs: 'empty' }); await sleep(900); await act({ type: 'workspace.select', id: first }); await sleep(900); wsMade = true; }
          await act({ type: 'settings.update', patch: { verticalTabs: true } }); await sleep(1300);
          if (await rightClick('.sb-ws[data-ws]')) await step('workspace-context', 'workspace-context'); else fails.push('workspace-context: no workspace icon in the sidebar');
          await closePopup(); await act({ type: 'settings.update', patch: { verticalTabs: false } }); await sleep(900); }
      } catch (error) { fails.push('case error: ' + String(error.message).split('\n')[0]); await closePopup().catch(() => {}); }
      if (crops.length) {
        const png = await ui.evaluate(async ({ crops, title }) => {
          const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
          const imgs = await Promise.all(crops.map(c => load(c.url))), head = 18, gap = 6, perRow = 7, rows = [];
          for (let i = 0; i < imgs.length; i += perRow) rows.push(imgs.slice(i, i + perRow));
          const rowW = r => r.reduce((a, i) => a + i.width + gap, gap), rowH = r => Math.max(...r.map(i => i.height)) + head + gap;
          const w = Math.max(...rows.map(rowW)), h = rows.reduce((a, r) => a + rowH(r), 0) + 4;
          const c = new OffscreenCanvas(w, h), g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '11px sans-serif';
          let y = 2, n = 0; for (const r of rows) { let x = gap; for (const i of r) { g.drawImage(i, x, y + head); g.fillText((n === 0 ? title + '  ' : '') + crops[n].name, x + 2, y + 12); x += i.width + gap; n++; } y += rowH(r); }
          const blob = await c.convertToBlob({ type: 'image/png' }), bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s);
        }, { crops, title: tag });
        await fs.writeFile(path.join(OUT, tag + '.png'), Buffer.from(png, 'base64'));
      }
      results.push({ tag, pass: !fails.length, fails, oks, needs, unknown: [...unknown] });
      log('need', tag, JSON.stringify(needs));
      log(fails.length ? 'FAIL' : 'PASS', tag, fails.length, 'hits');
    }
  } finally {
    clearTimeout(watchdog);
    try { await app?.close(); } catch {}
    server.close();
  }
});
await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter(r => !r.pass);
log(`${results.length - failed.length}/${results.length} cases passed; evidence ${OUT}`);
process.exit(failed.length ? 1 : 0);
