// Round 6 page motion: what the page does while the sidebar or top bar moves. A Windows Graphics Capture recording (ffmpeg
// gfxcapture=hwnd, 60 fps) of the one test window while the sidebar opens and closes (docked, or floating over the page), or the
// Seamless top bar drops. The fixture is a solid magenta page with a hard black/white stripe patch pinned to its top-left corner, so
// every frame can be measured: the page box, any hole inside it (a strip of something else), and how sharp the patch is (a blur
// from a frosted resize turns the black stripes grey).
//   node qa/page-resize-motion.mjs [outDir]
//   env PM_CASES=dock-full-site,peek-compact-split2,...   (<scenario>-<view>-<page>; scenario dock|peek|top; view full|compact|seamless;
//                                                         page site|newtab|split2|split3|split4)
//       PM_CROP=w:h:x:y (zoomed contact sheet of that window region, physical px)   PM_FROM/PM_EVERY=frame range and step
//       PM_SCALE=100|150   PM_SHEETS=1 (keep contact sheets, default on)   PM_KEEP=1 (keep every frame png)
// Prints, per transition, one row per distinct frame: time, page box, holes (px inside the box that are not page), sharp% of the patch.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {startApp, sleep, httpFixture} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const FFMPEG = process.env.FFMPEG || 'C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe';
const OUT = path.resolve(process.argv[2] || 'C:/ae/r6/page-motion'); await fs.mkdir(OUT, {recursive: true});
const SCALE = Number(process.env.PM_SCALE || 100);
const CASES = (process.env.PM_CASES || 'dock-full-site,dock-full-newtab,dock-compact-site,peek-compact-site,peek-compact-split2,peek-seamless-site,top-seamless-site').split(',');
const log = (...a) => console.log('[page-motion]', ...a);
// A deliberately heavy page (case kind `heavy`): 6000 laid-out boxes and a layout read on every resize, to see what resizing every frame costs.
const HEAVY = '<!doctype html><title>heavy</title><body style="margin:0;background:#ff00ff"><div style="position:absolute;left:24px;top:24px;width:160px;height:40px;background:repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)"></div><div id=g style="position:absolute;left:0;top:100px;right:0;display:flex;flex-wrap:wrap"></div><script>'
  + 'let h="";for(let i=0;i<6000;i++)h+="<div style=\\"width:"+(40+i%7*9)+"px;height:22px;margin:2px;background:hsl("+(i*37%360)+" 60% 70%)\\"><span>"+i+"</span></div>";g.innerHTML=h;'
  + 'onresize=()=>{let s=0;for(const c of g.children)s+=c.offsetWidth}</script>';

await withSlot('page-resize-motion', async () => {
  const hue = ['#ff00ff', '#00e0ff', '#ffe000', '#40ff40'];
  const page = await httpFixture((q, r) => {
    if (q.url === '/h') { r.setHeader('content-type', 'text/html'); r.end(HEAVY); return; }
    const n = Number(q.url.slice(1)) || 0;
    r.setHeader('content-type', 'text/html');
    r.end(`<!doctype html><title>pm${n}</title><body style="margin:0;background:${hue[n]};overflow:hidden"><div style="position:absolute;left:24px;top:24px;width:160px;height:40px;background:repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px)"></div><div id=w style="position:absolute;left:24px;top:90px;font:700 28px system-ui">w</div><script>const f=()=>w.textContent=innerWidth+'x'+innerHeight;onresize=f;f()</script></body>`);
  });
  let app;
  const watchdog = setTimeout(() => { log('watchdog: closing'); void app?.close().catch(() => {}); }, 14 * 60_000); watchdog.unref();
  try {
    app = await startApp({root: `.qa-profiles/page-resize-motion-${Date.now()}`});
    const display = await app.main(({screen}) => { const d = screen.getPrimaryDisplay(); return {x: d.workArea.x, y: d.workArea.y, scale: d.scaleFactor}; });
    const bounds = {x: display.x + 60, y: display.y + 40, width: 1200, height: 800};
    await app.main(({BaseWindow}, b) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds(b); w.setBounds(b); if (!w.isVisible()) w.showInactive(); }, bounds);
    await app.act({type: 'settings.update', patch: {style: 'acira', appearance: process.env.PM_APPEARANCE || 'dark', sidebarWidth: 240, bookmarksBar: false, interfaceScale: SCALE, verticalTabs: true, reducedMotion: false, animationSpeed: 'premium', sidebarPeek: {full: true, compact: true, focus: true}}});
    app.ui.on('pageerror', e => log('ui pageerror', String(e).slice(0, 300))); app.ui.on('console', m => { if (m.type() === 'error') log('ui console error', m.text().slice(0, 300)); });
    if (process.env.PM_CSS) await app.ui.addStyleTag({content: process.env.PM_CSS}); // experiment: CSS injected into the interface before the cases run
    const hwnd = await app.main(({BaseWindow}) => String(BaseWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE(0)));
    const url = n => `http://127.0.0.1:${page.port}/${n}`;
    const first = (await app.state()).activeTabId;
    await app.act({type: 'tab.navigate', tabId: first, url: url(0)});
    for (const n of [1, 2, 3]) await app.act({type: 'tab.new', url: url(n), background: true});
    const tabs = (await app.state()).tabs.map(t => t.id);
    const results = [];
    for (const name of CASES) {
      const [scenario, view, kind] = name.split('-');
      await app.act({type: 'split.close'}).catch(() => {});
      await app.act({type: 'ui.update', patch: {workspaceOpen: false, webWorkspaceOpen: false}});
      await app.act({type: 'settings.update', patch: {windowView: view}}); await sleep(500);
      if (kind === 'newtab') { await app.act({type: 'tab.new'}); await sleep(900); }
      else if (kind === 'heavy') { await app.act({type: 'tab.navigate', tabId: tabs[0], url: url('h')}); await app.act({type: 'tab.select', id: tabs[0]}); await sleep(2500); }
      else if (kind === 'settings') { await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1200); }
      else {
        await app.act({type: 'tab.select', id: tabs[0]});
        const n = /split(\d)/.exec(kind)?.[1];
        if (kind === 'splitmix') {
          // The founder's split: a website beside a new tab page (an interface page).
          await app.act({type: 'tab.new'}); await sleep(600);
          const fresh = (await app.state()).activeTabId;
          await app.act({type: 'split.open', tabIds: [tabs[0], fresh]}); await app.act({type: 'tab.select', id: tabs[0]});
        } else if (n) { await app.act({type: 'split.open', tabIds: tabs.slice(0, 2)}); for (const id of tabs.slice(2, Number(n))) await app.act({type: 'split.add', tabId: id}); }
        await sleep(900);
      }
      const activeId = (await app.state()).activeTabId;
      // PM_KEYS=1 asks for the edge the way a key does (main's edge command); the default sends main's own 'chrome-edge' event, as the pointer would (no real cursor).
      const pointer = on => app.main(({webContents}, a) => { const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); ui.send('acira:browser-event', {type: 'chrome-edge', top: a.top, side: a.side, pinned: {top: false, side: false}}); }, {top: scenario === 'top' && on, side: scenario === 'peek' && on});
      const keys = on => scenario === 'peek' ? app.cmd(on ? {type: 'edge', tabId: activeId, keys: {top: false, side: true}} : {type: 'edge', tabId: activeId, keys: {top: false, side: false}, dismiss: 'side'})
        : app.cmd(on ? {type: 'edge', tabId: activeId, keys: {top: true, side: false}} : {type: 'edge', tabId: activeId, keys: {top: false, side: false}, dismiss: 'top'});
      const edge = on => scenario === 'dock' ? app.act({type: 'ui.update', patch: {workspaceOpen: on, webWorkspaceOpen: on}}) : process.env.PM_KEYS ? keys(on) : pointer(on);
      if (process.env.PM_NTP) {
        // The new tab page's own state on every frame of the open (sampled after paint): does it remount, fade, or hide?
        await edge(false); await sleep(900);
        await app.ui.evaluate(() => { window.__t = []; window.__on = true; const t0 = performance.now(), f = () => { if (!window.__on) return; requestAnimationFrame(f); setTimeout(() => { const pane = [...document.querySelectorAll('.page-pane')].find(p => !p.hasAttribute('data-web')), nt = pane?.querySelector('.nt-page'), art = pane?.querySelector('.nt-art'), stack = pane?.querySelector('.nt-stack'); const o = el => el ? +getComputedStyle(el).opacity : null; window.__t.push([Math.round(performance.now() - t0), !!nt, nt && nt.dataset ? JSON.stringify(nt.dataset).slice(0, 60) : '', o(nt), o(stack), o(art), pane ? Math.round(pane.getBoundingClientRect().x) : null, document.documentElement.dataset.sidebarOverlay || '', document.documentElement.dataset.modeSwitch || '', document.querySelectorAll('.nt-page').length]); }, 0); }; requestAnimationFrame(f); });
        await sleep(150); await edge(true); await sleep(1200);
        const rows = await app.ui.evaluate(() => { window.__on = false; const out = []; let prev = ''; for (const r of window.__t) { const k = JSON.stringify(r.slice(1)); if (k !== prev) out.push(r[0] + 'ms nt=' + r[1] + ' data=' + r[2] + ' op(nt,stack,art)=' + [r[3], r[4], r[5]] + ' paneX=' + r[6] + ' overlay=' + r[7] + ' mode=' + r[8] + ' ntCount=' + r[9]); prev = k; } return out; });
        log('NTP', name); for (const r of rows) log('  ' + r);
        await edge(false); await sleep(700); continue;
      }
      if (process.env.PM_BISECT) {
        // One real frame per variant of the live page, sampled where PM_BISECT="x,y" says: which switch brings a missing pane back.
        const [bx, by] = process.env.PM_BISECT.split(',').map(Number), file = path.join(OUT, 'bisect.png');
        const grab = async label => {
          await fs.rm(file, {force: true});
          await new Promise(r => spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `gfxcapture=hwnd=${hwnd}:capture_cursor=0:max_framerate=30`, '-vf', 'hwdownload,format=bgra', '-frames:v', '1', file], {stdio: 'ignore'}).on('exit', r));
          const rgb = await app.main(({}, a) => { const {nativeImage} = process.mainModule.require('electron'), img = nativeImage.createFromPath(a.file), {width: W} = img.getSize(), bmp = img.toBitmap(), i = (a.y * W + a.x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; }, {file, x: bx, y: by});
          log('BISECT', label, JSON.stringify(rgb));
        };
        await edge(true); await sleep(1300); await grab('overlay open');
        for (const [label, js] of [
          ['desktopMaterial=unavailable', "document.documentElement.dataset.desktopMaterial='unavailable'"],
          ['+ sidebarOverlay removed', "delete document.documentElement.dataset.sidebarOverlay"],
        ]) { await app.ui.evaluate(js); await sleep(400); await grab(label); }
        await app.ui.evaluate("document.documentElement.dataset.desktopMaterial='ready'"); await sleep(300);
        await edge(false); await sleep(700); continue;
      }
      if (process.env.PM_PANES) {
        // Every pane while the edge shows: what it is, whether it paints, and what hides it.
        await edge(true); await sleep(1300);
        const panes = await app.ui.evaluate(() => {
          const root = document.documentElement, chain = el => { const out = []; for (let n = el; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility !== 'visible' || cs.display === 'none' || +cs.opacity < 1) out.push(`${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]} vis=${cs.visibility} disp=${cs.display} op=${cs.opacity}`); } return out; };
          return {overlay: root.dataset.sidebarOverlay || null, edgeFloat: root.dataset.edgeFloat || null, material: root.dataset.desktopMaterial, panes: [...document.querySelectorAll('.page-pane')].map(p => { const r = p.getBoundingClientRect(), art = p.querySelector('.page-zoom-content > *'); return {data: {web: p.hasAttribute('data-web'), pane: p.dataset.pane}, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: getComputedStyle(p).backgroundColor, hidden: chain(art || p), childBox: art && [Math.round(art.getBoundingClientRect().width), Math.round(art.getBoundingClientRect().height)]}; })};
        });
        log('PANES', name, JSON.stringify(panes, null, 1));
        const stack = await app.ui.evaluate(() => [[900, 500], [1000, 300]].map(([x, y]) => document.elementsFromPoint(x, y).slice(0, 8).map(el => { const cs = getComputedStyle(el); return el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.') + ' op=' + cs.opacity + ' vis=' + cs.visibility + ' z=' + cs.zIndex + ' bg=' + cs.backgroundColor + ' vt=' + cs.viewTransitionName + ' clip=' + (cs.clipPath !== 'none' ? cs.clipPath.slice(0, 40) : '-'); })));
        log('STACK', JSON.stringify(stack, null, 1));
        await edge(false); await sleep(700); continue;
      }
      if (process.env.PM_STYLES) {
        // What each layer of the frame paints (its resolved background and the root flags that choose it), docked open.
        await edge(true); await sleep(1300);
        const styles = await app.ui.evaluate(() => {
          const root = document.documentElement, pick = sel => { const n = document.querySelector(sel); if (!n) return null; const cs = getComputedStyle(n), r = n.getBoundingClientRect(); return {box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: cs.backgroundColor, img: cs.backgroundImage.slice(0, 90), op: cs.opacity, filter: cs.backdropFilter}; };
          return {flags: {...root.dataset}, appData: {...(document.querySelector('.app')?.dataset || {})}, cls: document.querySelector('.app')?.className, app: pick('.app'), rail: pick('.acira-sidebar, .ed-rail'), shell: pick('.browser-shell'), toolbar: pick('.browser-toolbar'), pageArea: pick('.page-area'), body: pick('body')};
        });
        log('STYLES', name, JSON.stringify(styles, null, 1));
        // Every painting layer under an empty sidebar point and an empty toolbar point (elements and their pseudo-elements).
        const layers = await app.ui.evaluate(() => {
          const describe = el => { const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 3).join('.') : ''), out = []; for (const pseudo of [null, '::before', '::after']) { const cs = getComputedStyle(el, pseudo); const paint = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none'; if (paint && (pseudo === null || cs.content !== 'none')) out.push(`${tag}${pseudo || ''} bg=${cs.backgroundColor} img=${cs.backgroundImage.slice(0, 70)} op=${cs.opacity}`); } return out; };
          const at = (x, y) => [...document.querySelectorAll("*")].filter(el => { const r = el.getBoundingClientRect(); const fixed = getComputedStyle(el).position === "fixed"; return r.width && r.height && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }).flatMap(describe);
          return {sidebar: at(120, 600), toolbarEmpty: at(330, 4), toolbarMid: at(700, 4), pageBandBottom: at(700, 797)};
        });
        log('LAYERS', name, JSON.stringify(layers, null, 1));
        await edge(false); await sleep(700); continue;
      }
      if (process.env.PM_TRACK) {
        // The page content's rect on every frame while the edge shows: it must not move (a jump that settles a frame later is the glitch).
        await edge(false); await sleep(900);
        for (const on of [true, false, true]) {
          await app.ui.evaluate(() => { window.__track = []; window.__tracking = true; const t0 = performance.now(), f = () => { if (!window.__tracking) return; requestAnimationFrame(f); /* sampled after the frame painted: what the person saw */ setTimeout(() => { const c = document.querySelector('.page-area > .page-content')?.getBoundingClientRect(), a = document.querySelector('.page-area')?.getBoundingClientRect(), tb = document.querySelector('.browser-shell')?.getBoundingClientRect(); window.__track.push([Math.round(performance.now() - t0), c && [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], a && [Math.round(a.left), Math.round(a.top), Math.round(a.width), Math.round(a.height)], tb && [Math.round(tb.top), Math.round(tb.height)], document.documentElement.dataset.sidebarOverlay || document.documentElement.dataset.edgeFloat || '' + ' pin ' + document.documentElement.style.getPropertyValue('--sidebar-page-top') + ',' + document.documentElement.style.getPropertyValue('--sidebar-page-left')]); }, 0); }; requestAnimationFrame(f); });
          await sleep(200); await edge(on); await sleep(900);
          const rows = await app.ui.evaluate(() => { window.__tracking = false; const out = []; let prev = ''; for (const r of window.__track) { const k = JSON.stringify(r.slice(1)); if (k !== prev) out.push(r[0] + 'ms content ' + JSON.stringify(r[1]) + ' area ' + JSON.stringify(r[2]) + ' toolbar ' + JSON.stringify(r[3]) + ' ' + r[4]); prev = k; } return out; });
          log('TRACK', name, on ? 'show' : 'hide'); for (const r of rows) log('  ' + r);
        }
        continue;
      }
      if (process.env.PM_PROBE) {
        // Geometry of the floating sidebar, the corner pieces and the native page, once the reveal has settled.
        await edge(true); await sleep(1100);
        const ui = await app.ui.evaluate(() => { const r = n => { const b = document.querySelector(n)?.getBoundingClientRect(); return b && {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height)}; }, cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim() || document.querySelector('.app')?.style.getPropertyValue(n); return {overlay: document.documentElement.dataset.sidebarOverlay, edgeFloat: document.documentElement.dataset.edgeFloat, cornerX: v('--sf-corner-x'), travel: v('--sf-sidebar-travel'), peek: r('.acira-sidebar.is-peek'), corners: r('.sidebar-page-corners'), pageArea: r('.page-area'), pageContent: r('.page-content')}; });
        const views = await app.main(({BaseWindow}) => BaseWindow.getAllWindows()[0].contentView.children.map((v, i) => { try { return {i, url: v.webContents.getURL().slice(0, 40), ...v.getBounds(), vis: v.getVisible()}; } catch { return null; } }).filter(Boolean));
        log('PROBE', name, JSON.stringify({ui, views}));
        await edge(false); await sleep(700); continue;
      }
      for (const step of (process.env.PM_ORDER || 'open,close').split(',')) {
        const dir = path.join(OUT, `${name}-${SCALE}-${step}`); await fs.rm(dir, {recursive: true, force: true}); await fs.mkdir(dir, {recursive: true});
        const rec = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `gfxcapture=hwnd=${hwnd}:capture_cursor=0:max_framerate=60`, '-vf', 'hwdownload,format=bgra', '-t', '1.8', '-vsync', '0', path.join(dir, 'f%03d.png')], {stdio: 'ignore'});
        await sleep(900);
        await edge(step === 'open');
        // A still window gives the capture no frames, so -t never ends: a hard cap per recording.
        const cap = setTimeout(() => spawn('taskkill', ['/PID', String(rec.pid), '/T', '/F'], {stdio: 'ignore'}), 5000);
        await new Promise(r => rec.on('exit', r)); clearTimeout(cap); await sleep(400);
        const files = (await fs.readdir(dir)).filter(f => f.endsWith('.png')).sort();
        const rows = kind === "newtab" || kind === "settings" ? [] : await app.main(async ({}, a) => {
          const {nativeImage} = process.mainModule.require('electron'), out = [];
          let prev = '';
          for (const f of a.files) {
            const img = nativeImage.createFromPath(a.dir + '/' + f), {width: W, height: H} = img.getSize(), bmp = img.toBitmap();
            const px = (x, y) => { const i = (y * W + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
            const near = (c, k) => Math.abs(c[0] - k[0]) < 40 && Math.abs(c[1] - k[1]) < 40 && Math.abs(c[2] - k[2]) < 40;
            const cols = a.hue.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
            // The page box: the extent of the fixture's colours, counted per column so a few stray pixels do not stretch it.
            const colHit = new Array(W).fill(0), rowHit = new Array(H).fill(0); let total = 0;
            for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const c = px(x, y); if (cols.some(k => near(c, k))) { colHit[x]++; rowHit[y]++; total++; } }
            let minX = colHit.findIndex(v => v > 40), maxX = W - 1 - [...colHit].reverse().findIndex(v => v > 40), minY = rowHit.findIndex(v => v > 40), maxY = H - 1 - [...rowHit].reverse().findIndex(v => v > 40);
            if (minX < 0 || total < 500) { out.push(f + ' no page'); prev = ''; continue; }
            let holes = 0, seen = 0;
            for (let y = minY + 6; y < maxY - 6; y += 3) for (let x = minX + 3; x < maxX - 3; x += 3) { seen++; const c = px(x, y); if (!cols.some(k => near(c, k)) && !(c[0] < 40 && c[1] < 40 && c[2] < 40) && !(c[0] > 215 && c[1] > 215 && c[2] > 215)) holes++; }
            // The stripe patch sits 24px in from the page's top-left (physical px: scale it); sharp = share of near-black pixels in it.
            const s = a.scale, sx = minX + Math.round(24 * s), sy = minY + Math.round(24 * s); let black = 0, n = 0;
            for (let y = sy + 2; y < sy + Math.round(36 * s); y += 2) for (let x = sx; x < sx + Math.round(150 * s); x += 1) { n++; const c = px(x, y); if (c[0] < 30 && c[1] < 30 && c[2] < 30) black++; }
            const row = `box ${minX},${minY}-${maxX},${maxY} w ${maxX - minX + 1} holes ${(100 * holes / Math.max(1, seen)).toFixed(1)}% sharp ${(100 * black / Math.max(1, n)).toFixed(0)}%`;
            if (row !== prev) out.push(f + ' ' + row); prev = row;
          }
          return out;
        }, {dir, files, hue, scale: display.scale * SCALE / 100});
        if (process.env.PM_SAMPLE) {
          // PM_SAMPLE="sidebar:150,700;toolbar:1000,24": the window's real pixels at those points, one row per frame that changes them.
          const pts = process.env.PM_SAMPLE.split(';').map(s => { const [n, xy] = s.split(':'), [x, y] = xy.split(',').map(Number); return {n, x, y}; });
          const sampled = await app.main(async ({}, a) => {
            const {nativeImage} = process.mainModule.require('electron'), out = []; let prev = '';
            for (const f of a.files) { const img = nativeImage.createFromPath(a.dir + '/' + f), {width: W} = img.getSize(), bmp = img.toBitmap(); const row = a.pts.map(p => { const i = (p.y * W + p.x) * 4; return `${p.n}=${bmp[i + 2]},${bmp[i + 1]},${bmp[i]}`; }).join(' '); if (row !== prev) out.push(f + ' ' + row); prev = row; }
            return out;
          }, {dir, files, pts});
          log('SAMPLE', name, step); for (const r of sampled) log('  ' + r);
        }
        log(`${name} ${step}: ${files.length} frames, distinct:`); for (const r of rows) log('  ' + r);
        results.push({name, step, frames: files.length, rows});
        if (process.env.PM_SHEETS !== '0') await new Promise(r => spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '60', '-i', path.join(dir, 'f%03d.png'), '-vf', `select='gte(n,${process.env.PM_FROM || 3})*not(mod(n,${process.env.PM_EVERY || 2}))',${process.env.PM_CROP ? `crop=${process.env.PM_CROP},scale=iw*${process.env.PM_ZOOM || 3}:ih*${process.env.PM_ZOOM || 3}:flags=neighbor,tile=4x3` : 'scale=iw/3:-1,tile=4x4'}`, '-frames:v', '1', path.join(OUT, `${name}-${SCALE}-${step}.sheet.png`)], {stdio: 'ignore'}).on('exit', r));
        if (!process.env.PM_KEEP) await fs.rm(dir, {recursive: true, force: true});
        await sleep(300);
      }
      await edge(false); await sleep(400);
    }
    await fs.writeFile(path.join(OUT, `result-${Date.now()}.json`), JSON.stringify(results, null, 1));
  } finally { clearTimeout(watchdog); try { await app?.close(); } catch {} await page.close(); }
});
