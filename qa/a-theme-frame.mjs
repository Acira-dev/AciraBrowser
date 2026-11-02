// F04 (M's sweep: "theme switch one 53 ms frame" at 27 tabs). Opens 26 fixture tabs (27 with the first), then switches
// the appearance light ↔ dark a few times and, for 1.2 s after each switch, records every frame of the chrome (rAF gaps)
// and its long animation frames with their script attribution and style/layout share. A_PROFILE=1 also writes a CPU
// profile of the second switch. Isolated, one instance, showInactive, capped.   node qa/a-theme-frame.mjs [outdir]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep} from './d-harness.mjs';

const out = process.argv[2] || path.resolve('qa/artifacts/a-theme-frame'); await fs.mkdir(out, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>Page ${req.url.slice(1)}</title><body style="font:16px system-ui">page ${req.url}</body>`); });
const dir = '.qa-profiles/a-theme-frame'; await fs.rm(dir, {recursive: true, force: true});
const app = await startApp({root: dir, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
const record = () => app.ui.evaluate(() => {
  const w = window; w.__frames = []; w.__loaf = []; w.__recording = true; w.__switching = 0; w.__chrome0 = getComputedStyle(document.querySelector('.app') || document.documentElement).getPropertyValue('--ed-chrome').trim();
  const tick = t => { w.__frames.push(t); if (document.documentElement.dataset.modeSwitch) w.__switching++; if (w.__recording && w.__frames.length < 400) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  w.__observer?.disconnect();
  w.__observer = new PerformanceObserver(list => { for (const e of list.getEntries()) w.__loaf.push({start: e.startTime, duration: Math.round(e.duration), styleLayout: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0), render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), scripts: e.scripts.map(s => ({fn: s.sourceFunctionName || s.invoker, src: (s.sourceURL || '').split('/').pop(), ms: Math.round(s.duration), forcedLayout: Math.round(s.forcedStyleAndLayoutDuration)})).filter(s => s.ms >= 2)}); });
  w.__observer.observe({type: 'long-animation-frame'});
  return performance.now();
});
const stop = () => app.ui.evaluate(() => { const w = window; w.__recording = false; w.__observer?.disconnect(); return {frames: w.__frames, loaf: w.__loaf, switching: w.__switching, visible: document.visibilityState, chrome: [w.__chrome0, getComputedStyle(document.querySelector('.app') || document.documentElement).getPropertyValue('--ed-chrome').trim()]}; });
const rows = [], failures = [];
const summarize = events => {
  const mark = events.find(e => e.name === 'UpdateLayoutTree' || e.name === 'FunctionCall'); if (!mark) return console.log('   trace: no renderer events');
  const main = events.filter(e => e.pid === mark.pid && e.ph === 'X' && e.dur);
  const threads = {}; for (const e of main) threads[e.tid] = (threads[e.tid] || 0) + e.dur; const tid = +Object.entries(threads).sort((a, b) => b[1] - a[1])[0][0];
  const top = main.filter(e => e.tid === tid).sort((a, b) => a.ts - b.ts); const tasks = top.filter(e => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask');
  const long = tasks.filter(t => t.dur > 16000).slice(0, 4);
  for (const t of long) { const inside = top.filter(e => e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e !== t); const by = {}; for (const e of inside) by[e.name] = (by[e.name] || 0) + e.dur;
    console.log(`   task ${(t.dur / 1000).toFixed(1)}ms: ` + Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, d]) => `${n} ${(d / 1000).toFixed(1)}`).join(', ')); }
  if (!long.length) console.log('   trace: no task over 16ms on the renderer main thread');
};
try {
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 60, y: 40, width: 1440, height: 900}); w.showInactive(); });
  await app.act({type: 'settings.update', patch: {appearance: 'light', verticalTabs: false, interfaceScale: Number(process.env.A_SCALE || 100)}});
  for (let i = 1; i <= (process.env.A_SETTINGS ? 25 : 26); i++) { await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/${i}`}); await sleep(120); }
  // A_SETTINGS=1: Settings › Appearance (its finish swatches re-render on a switch) is the page in front.
  if (process.env.A_SETTINGS) { await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1500); await app.ui.evaluate(() => { const nav = [...document.querySelectorAll('nav button, nav a, [role=tab]')].find(n => /^Appearance/.test(n.textContent.trim())); nav?.click(); }); await sleep(1200); console.log('finish swatches on screen:', await app.ui.evaluate(() => document.querySelectorAll('.glass-finish-grid > *').length)); }
  await sleep(2500);
  console.log('tabs:', (await app.state()).tabs.length);
  const cdp = process.env.A_PROFILE || process.env.A_TRACE ? await app.context.newCDPSession(app.ui) : null;
  // A_TRACE=1: a timeline trace of the second switch; the renderer main thread's top-level work in the first 120ms is
  // summed by event name (style, layout, paint, script) so the update frame's cost is named.
  const events = []; if (process.env.A_TRACE) cdp.on('Tracing.dataCollected', e => events.push(...e.value));
  const targets = ['dark', 'light', 'dark', 'light', 'dark', 'light'];
  for (let i = 0; i < targets.length; i++) {
    const to = targets[i];
    if (process.env.A_TRACE && i === Number(process.env.A_TRACE_AT || 1)) await cdp.send('Tracing.start', {categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,v8.execute,blink.user_timing', transferMode: 'ReportEvents'});
    if (process.env.A_PROFILE && i === 1) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', {interval: 100}); await cdp.send('Profiler.start'); }
    const t0 = await record();
    await app.act({type: 'settings.update', patch: {appearance: to}});
    await sleep(1200);
    const {frames, loaf, switching, visible, chrome} = await stop();
    if (process.env.A_TRACE && i === Number(process.env.A_TRACE_AT || 1)) { const done = new Promise(r => cdp.once('Tracing.tracingComplete', r)); await cdp.send('Tracing.end'); await done; await fs.writeFile(path.join(out, 'switch.trace.json'), JSON.stringify(events)); summarize(events); }
    if (process.env.A_PROFILE && i === 1) { const {profile} = await cdp.send('Profiler.stop'); await fs.writeFile(path.join(out, 'switch.cpuprofile'), JSON.stringify(profile)); }
    const gaps = frames.slice(1).map((t, k) => ({at: Math.round(frames[k] - t0), gap: Math.round(t - frames[k])}));
    const worst = gaps.reduce((a, b) => b.gap > a.gap ? b : a, {gap: 0});
    const long = loaf.filter(l => l.duration >= 30).map(l => ({at: Math.round(l.start - t0), ...l, start: undefined}));
    const longest = loaf.reduce((a, b) => b.duration > a.duration ? b : a, {duration: 0});
    rows.push({to, frames: frames.length, worst, over33: gaps.filter(g => g.gap > 33).length, long, longest: longest.duration, switching, visible, chrome});
    console.log(`→ ${to}: ${frames.length} frames, worst ${worst.gap}ms at +${worst.at}ms, ${gaps.filter(g => g.gap > 33).length} over 33ms; longest LoAF ${longest.duration}ms; view transition on ${switching} frames; ${visible}; chrome ${chrome.join(' → ')}`);
    for (const l of long) console.log(`   LoAF +${l.at}ms ${l.duration}ms (style/layout ${l.styleLayout}, render ${l.render}) ${JSON.stringify(l.scripts.slice(0, 5))}`);
    await sleep(800);
  }
  // Correctness of the switch itself: main got the new appearance, no color transition runs under the crossfade, and the
  // settle attribute is gone once it ends.
  for (const to of ['dark', 'light']) {
    await app.ui.evaluate(() => { window.__tx = null; const seen = () => { if (document.documentElement.dataset.themeSettle !== undefined && window.__tx === null) window.__tx = document.getAnimations().filter(a => a instanceof CSSTransition).length; else requestAnimationFrame(seen); }; requestAnimationFrame(seen); });
    await app.act({type: 'settings.update', patch: {appearance: to}}); await sleep(900);
    const check = await app.ui.evaluate(async () => ({native: (await window.acira.getBrowserLayout())?.appearance, transitions: window.__tx, settleLeft: document.documentElement.dataset.themeSettle !== undefined}));
    console.log(`check → ${to}: main layout appearance ${check.native}, color transitions under the crossfade ${check.transitions}, settle attribute left ${check.settleLeft}`);
    if (check.native !== to || check.transitions || check.settleLeft) failures.push(`${to}: ${JSON.stringify(check)}`);
  }
} finally { await app.close(); fx.close?.(); }
await fs.writeFile(path.join(out, 'frames.json'), JSON.stringify(rows, null, 1));
const worst = Math.max(...rows.slice(1).map(r => r.worst.gap));
console.log(`worst frame across switches (first excluded as warm-up): ${worst}ms`);
if (failures.length) { console.log('FAIL', failures.join('; ')); process.exitCode = 1; } else console.log('PASS: main follows the switch, no transitions under the crossfade, attribute cleared');
