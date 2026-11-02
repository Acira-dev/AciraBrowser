// Round 8 page-60fps: how many times per second does the page resize while the sidebar opens and closes, and how many of those
// resizes did the page actually repaint? Counts, per transition:
//   native  = setBounds calls that changed the website view's size (a wrapper on the view in the main process, timestamps in ms)
//   resizes = `resize` events the page received      frames = animation frames the page produced at a new width (rAF in the page)
//   ui      = for interface pages (new tab, Settings) and splits: distinct .page-content widths seen after paint in the UI renderer
// rate = changes / (first change to last change); head = changes inside the first 300 ms (the part that moves).
//   node qa/native-slot.mjs page-60fps -- node qa/page-60fps.mjs [outJson]
//   env P60_CASES=<scenario>-<view>-<page>,...  scenario dock|peek|top; view full|compact|seamless; page site|heavy|newtab|settings|split2|splitmix
//       P60_REPS=2   P60_LABEL=before|after
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, httpFixture} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

process.env.D_VISIBLE ??= '1';
const OUT = path.resolve(process.argv[2] || `C:/ae/r8/page-60fps/${process.env.P60_LABEL || 'run'}.json`); await fs.mkdir(path.dirname(OUT), {recursive: true});
const REPS = Number(process.env.P60_REPS || 2);
const CASES = (process.env.P60_CASES || [
  ...['full', 'compact', 'seamless'].flatMap(v => ['site', 'heavy', 'newtab', 'settings'].map(p => `dock-${v}-${p}`)),
  'peek-seamless-site', 'peek-seamless-heavy', 'peek-compact-site', 'dock-full-splitmix',
].join(',')).split(',');
const log = (...a) => console.log('[p60]', ...a);

// Every fixture page records its own resizes and the width it painted in each animation frame.
const PROBE = '<script>window.__pm={resizes:[],frames:[]};addEventListener("resize",()=>__pm.resizes.push(performance.now()));let last=-1;const raf=()=>{requestAnimationFrame(raf);__pm.frames.push([performance.now(),innerWidth]);if(__pm.frames.length>4000)__pm.frames.shift()};requestAnimationFrame(raf);</script>';
const para = i => `<p>Paragraph ${i}. The quick brown fox jumps over the lazy dog while the sidebar slides and this text has to reflow to the width it is given, every single frame, without a stutter.</p>`;
const SITE = `<!doctype html><title>site</title><body style="margin:0;background:#ff00ff;font:16px/1.5 system-ui"><header style="position:sticky;top:0;background:#222;color:#fff;padding:12px 24px;display:flex;gap:24px"><b>News</b><span>World</span><span>Tech</span><span>Sport</span></header><main style="max-width:900px;margin:0 auto;padding:24px;background:#fff"><h1>Headline of the day</h1><div style="display:flex;flex-wrap:wrap;gap:12px">${Array.from({length: 60}, (_, i) => `<div style="flex:1 1 220px;padding:12px;background:hsl(${i * 23} 60% 90%);border-radius:8px"><h3>Card ${i}</h3>${para(i)}</div>`).join('')}</div>${Array.from({length: 120}, (_, i) => para(i)).join('')}</main>${PROBE}`;
const HEAVY = `<!doctype html><title>heavy</title><body style="margin:0;background:#ff00ff"><div id=g style="display:flex;flex-wrap:wrap"></div><script>let h="";for(let i=0;i<6000;i++)h+="<div style=\\"width:"+(40+i%7*9)+"px;height:22px;margin:2px;background:hsl("+(i*37%360)+" 60% 70%)\\"><span>"+i+"</span></div>";g.innerHTML=h;onresize=()=>{let s=0;for(const c of g.children)s+=c.offsetWidth}</script>${PROBE}`;

const stats = (times, windowMs) => {
  if (times.length < 2) return {n: times.length, active: 0, rate: 0, head: 0, p95gap: 0, maxgap: 0};
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b), active = times.at(-1) - times[0];
  return {n: times.length, active: Math.round(active), rate: +((times.length - 1) / active * 1000).toFixed(1), head: times.filter(t => t - times[0] < windowMs).length, p95gap: +gaps[Math.floor(gaps.length * .95)].toFixed(1), maxgap: +gaps.at(-1).toFixed(1)};
};

await withSlot('page-60fps', async () => {
  const page = await httpFixture((q, r) => { r.setHeader('content-type', 'text/html'); r.end(q.url === '/h' ? HEAVY : SITE); });
  let app, profile;
  const watchdog = setTimeout(() => { log('watchdog: closing'); void app?.close().catch(() => {}); }, 14 * 60_000); watchdog.unref();
  const results = [];
  try {
    profile = `.qa-profiles/page-60fps-${Date.now()}`; app = await startApp({root: profile});
    const display = await app.main(({screen}) => { const d = screen.getPrimaryDisplay(); return {x: d.workArea.x, y: d.workArea.y, hz: d.displayFrequency, scale: d.scaleFactor}; });
    log('display', JSON.stringify(display));
    const bounds = {x: display.x + 60, y: display.y + 40, width: 1200, height: 800};
    await app.main(({BaseWindow}, b) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds(b); w.setBounds(b); if (!w.isVisible()) w.showInactive(); }, bounds);
    await app.act({type: 'settings.update', patch: {style: 'acira', appearance: 'dark', sidebarWidth: 240, bookmarksBar: false, interfaceScale: 100, verticalTabs: true, reducedMotion: false, animationSpeed: 'premium', sidebarPeek: {full: true, compact: true, focus: true}}});
    const site = n => `http://127.0.0.1:${page.port}/${n}`;
    const first = (await app.state()).activeTabId;
    await app.act({type: 'tab.navigate', tabId: first, url: site('s')});
    await app.act({type: 'tab.new', url: site('h'), background: true});
    const heavyId = (await app.state()).tabs.map(t => t.id).find(id => id !== first), tabs = [first, heavyId];
    for (const name of CASES) {
      const [scenario, view, kind] = name.split('-');
      await app.act({type: 'split.close'}).catch(() => {});
      await app.act({type: 'ui.update', patch: {workspaceOpen: false, webWorkspaceOpen: false}});
      await app.act({type: 'settings.update', patch: {windowView: view}}); await sleep(500);
      let url = site('s');
      if (kind === 'newtab') { await app.act({type: 'tab.new'}); await sleep(900); url = null; }
      else if (kind === 'settings') { await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1200); url = null; }
      else if (kind === 'heavy') { await app.act({type: 'tab.select', id: tabs[1]}); await sleep(2500); url = site('h'); }
      else {
        await app.act({type: 'tab.select', id: tabs[0]});
        if (kind === 'splitmix') {
          await app.act({type: 'tab.new'}); await sleep(600);
          const fresh = (await app.state()).activeTabId;
          await app.act({type: 'split.open', tabIds: [tabs[0], fresh]}); await app.act({type: 'tab.select', id: tabs[0]});
        }
        await sleep(900);
      }
      const pointer = on => app.main(({webContents}, a) => { const ui = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); ui.send('acira:browser-event', {type: 'chrome-edge', top: false, side: a.side, pinned: {top: false, side: false}}); }, {side: on});
      const edge = on => scenario === 'dock' ? app.act({type: 'ui.update', patch: {workspaceOpen: on, webWorkspaceOpen: on}}) : pointer(on);
      await edge(false); await sleep(1000);
      for (let rep = 0; rep < REPS; rep++) for (const step of ['open', 'close']) {
        // Instrument: the main-process view, the page's own probe, and the UI renderer's .page-content width after each paint.
        await app.main(({BaseWindow}) => {
          globalThis.__pmLog = [];
          const walk = v => [v, ...(v.children || []).flatMap(walk)];
          for (const v of walk(BaseWindow.getAllWindows()[0].contentView)) { let u = ''; try { u = v.webContents?.getURL() || ''; } catch {} if (!u.startsWith('http://127.0.0.1') || v.__orig) continue; v.__orig = v.setBounds; v.setBounds = function(b) { globalThis.__pmLog.push([performance.now(), b.x, b.y, b.width, b.height, u]); return v.__orig.call(this, b); }; }
        });
        const web = url && app.web(p => p === url);
        if (web) await web.evaluate(() => { __pm.resizes.length = 0; __pm.frames.length = 0; });
        await app.ui.evaluate(() => { window.__ui = []; window.__uiOn = true; const f = () => { if (!window.__uiOn) return; requestAnimationFrame(f); setTimeout(() => { const c = document.querySelector('.page-area > .page-content')?.getBoundingClientRect(); window.__ui.push([performance.now(), c ? Math.round(c.width * 10) / 10 : -1]); }, 0); }; requestAnimationFrame(f); });
        await sleep(300);
        const t0 = await app.main(() => performance.now());
        await edge(step === 'open'); await sleep(1300);
        await app.ui.evaluate(() => { window.__uiOn = false; });
        const native = await app.main(() => { const l = globalThis.__pmLog; for (const v of []) void v; return l; });
        await app.main(({BaseWindow}) => { const walk = v => [v, ...(v.children || []).flatMap(walk)]; for (const v of walk(BaseWindow.getAllWindows()[0].contentView)) if (v.__orig) { v.setBounds = v.__orig; delete v.__orig; } });
        const ui = await app.ui.evaluate(() => window.__ui);
        const probe = web ? await web.evaluate(() => ({resizes: __pm.resizes, frames: __pm.frames})) : null;
        // Main and page clocks differ (separate processes): rebase each stream to its own first change.
        const changed = [];
        let lastW = null; for (const r of native.filter(r => !url || r[5] === url)) { if (lastW !== null && r[3] !== lastW) changed.push(r[0]); lastW = r[3]; }
        const nativeBoundsSeen = native.filter(r => !url || r[5] === url).length;
        const uiChanged = []; let uw = null; for (const [t, w] of ui) { if (uw !== null && w !== uw) uiChanged.push(t); uw = w; }
        const repainted = []; if (probe) { let pw = null; for (const [t, w] of probe.frames) { if (pw !== null && w !== pw) repainted.push(t); pw = w; } }
        const frameTimes = probe?.frames.map(f => f[0]) || []; if (probe) log('  probe frames', probe.frames.length, 'widths', [...new Set(probe.frames.map(f => f[1]))].slice(0, 8).join(','), 'resizes', probe.resizes.length);
        const row = {name, step, rep, native: stats(changed, 300), nativeCalls: nativeBoundsSeen, resizes: probe ? stats(probe.resizes, 300) : null, repainted: probe ? stats(repainted, 300) : null, ui: stats(uiChanged, 300), uiRaf: stats(ui.map(s => s[0]).filter((t, i, all) => t - all[0] > 300 && t - all[0] < 800), 1e9), pageFramesPerSec: frameTimes.length > 3 ? +(1000 * (frameTimes.length - 1) / (frameTimes.at(-1) - frameTimes[0])).toFixed(0) : null};
        results.push(row);
        const f = s => s ? `${s.n}/${s.active}ms=${s.rate}/s head${s.head} p95gap${s.p95gap} max${s.maxgap}` : '-';
        log(`${name} ${step}${rep}: native ${f(row.native)} | resizes ${f(row.resizes)} | repainted ${f(row.repainted)} | ui ${f(row.ui)} | uiRaf ${f(row.uiRaf)}`);
        await sleep(300);
      }
      await edge(false); await sleep(400);
    }
  } finally { clearTimeout(watchdog); await fs.writeFile(OUT, JSON.stringify(results, null, 1)).catch(() => {}); if (process.env.P60_LOADS) for (const l of app?.logs || []) for (const line of String(l).split('\n')) if (line.includes("pm-load")) log(line); try { await app?.close(); } catch {} await page.close(); if (profile) await fs.rm(profile, {recursive: true, force: true}).catch(() => {}); }
});
