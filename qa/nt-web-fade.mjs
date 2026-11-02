// Round 4 (nt-web-fade): new tab page <-> website, recorded from the window at 60 Hz (ffmpeg gfxcapture on the window handle) and
// measured per frame: mean luma of the page area. A hard cut shows as a dip (dark frame) or a spike (white frame) and a one-frame step;
// the dissolve shows as a monotone ramp. Cases: tab.select new tab -> website (a real click on the tab), website -> new tab (a real click),
// and a navigation from the new tab to a website that answers after 180 ms. Dark + light, 100%.
// Usage: node qa/nt-web-fade.mjs <outdir> [before]   ("before" runs with ACIRA_QA_NO_NTP_STILL=1: the old hard cut)
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn, execFileSync} from 'node:child_process';
import {startApp, sleep, poll} from './d-harness.mjs';

const FFMPEG = process.env.FFMPEG || 'C:/Users/you/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe';
const before = process.argv[3] === 'before';
const out = path.resolve(process.argv[2] || 'C:/ae/r4/ntfade/evidence', before ? 'before' : 'after'); await fs.mkdir(out, {recursive: true});
// A mid-tone website (luma ~105): a white frame (255) and a dark frame (~25) both stand out against it and against the new tab page.
const site = '<!doctype html><title>Fade site</title><body style="margin:0;background:#3d6fa6;color:#fff;font:600 28px system-ui"><div style="padding:60px">Fade test site</div><div style="margin:0 60px;height:220px;background:#2b5585"></div></body>';
const server = http.createServer((req, res) => setTimeout(() => { res.writeHead(200, {'content-type': 'text/html'}); res.end(site); }, req.url.startsWith('/slow') ? 180 : 0));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let slot;
for (let attempt = 0; attempt < 40 && !slot; attempt++) {
  for (const n of [1, 2, 3]) { try { const file = `C:/ae/slot-${n}.lock`; fss.writeFileSync(file, `ntfade ${new Date().toISOString()}`, {flag: 'wx'}); slot = file; break; } catch {} }
  if (!slot) await sleep(30000);
}
if (!slot) throw new Error('no native slot');
const results = [];
let app;
try {
  const dir = '.qa-profiles/ntfade'; await fs.rm(dir, {recursive: true, force: true});
  app = await startApp({root: dir, env: {ACIRA_BROWSER_TEST_HIDDEN: '0', ...(before ? {ACIRA_QA_NO_NTP_STILL: '1'} : {})}});
  const hwnd = await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 40, y: 30, width: 1280, height: 820}); w.show(); w.setAlwaysOnTop(true, 'floating'); const h = w.getNativeWindowHandle(); return String(h.length >= 8 ? h.readBigUInt64LE() : h.readUInt32LE()); });
  const record = (file, seconds) => { const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `gfxcapture=hwnd=${hwnd}:capture_cursor=0:max_framerate=60`, '-vf', 'hwdownload,format=bgra', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv444p', '-fps_mode', 'cfr', '-r', '60', '-t', String(seconds), file], {stdio: ['pipe', 'ignore', 'pipe']}); let err = ''; ff.stderr.on('data', x => { err += x; }); return new Promise(resolve => { const t = setTimeout(() => { try { ff.kill(); } catch {} resolve(err); }, (seconds + 12) * 1000); ff.on('exit', () => { clearTimeout(t); resolve(err); }); }); };
  // Mean luma per frame of a region well inside the page area (clear of the toolbar, the strip and the page corners).
  const luma = file => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'crop=760:440:260:260,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], {encoding: 'utf8', maxBuffer: 1 << 24}).split('\n').filter(l => l.includes('YAVG')).map(l => +l.split('=')[1]);
  const strip = (file, from, png) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', `select='between(n\\,${from}\\,${from + 23})',scale=426:-1,tile=6x4:padding=4:color=gray`, '-frames:v', '1', '-fps_mode', 'passthrough', png]);
  const analyse = (name, file) => {
    const y = luma(file); if (y.length < 20) return {name, frames: y.length};
    const start = y[0], end = y.at(-1), lo = Math.min(start, end), hi = Math.max(start, end), span = Math.max(1, hi - lo);
    const first = y.findIndex(v => Math.abs(v - start) > 1.5), steps = [];
    for (let i = 1; i < y.length; i++) steps.push(Math.abs(y[i] - y[i - 1]));
    // Dip = a frame darker than both ends; spike = brighter than both ends (each by more than 6 luma).
    const dips = y.filter(v => v < lo - 6).length, spikes = y.filter(v => v > hi + 6).length;
    const transitionFrames = y.filter(v => v > lo + span * 0.1 && v < hi - span * 0.1).length;
    const maxStep = Math.max(...steps), maxStepShare = +(maxStep / span).toFixed(2);
    const r = {name, frames: y.length, start: +start.toFixed(1), end: +end.toFixed(1), firstChange: first, dips, spikes, transitionFrames, maxStep: +maxStep.toFixed(1), maxStepShare, series: y.slice(Math.max(0, first - 3), first + 30).map(v => +v.toFixed(1))};
    try { strip(file, Math.max(0, first - 2), path.join(out, name + '-strip.png')); } catch (e) { r.stripError = String(e.message).slice(0, 200); }
    console.log(JSON.stringify({...r, series: r.series.join(' ')}));
    return r;
  };
  const tabEl = id => app.ui.locator(`[data-tab-id="${id}"]`).first();
  // Window capture only delivers frames when the window changes: a 2px ticker in the interface's top-left corner (outside the measured
  // page area) keeps 60 frames a second coming while a page sits still.
  await app.ui.evaluate(() => { const d = document.createElement('div'); d.id = 'qa-ticker'; d.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;z-index:2147483647;pointer-events:none'; document.body.append(d); let on = false; const tick = () => { on = !on; d.style.background = on ? '#010101' : '#020202'; requestAnimationFrame(tick); }; tick(); });
  for (const theme of ['dark', 'light']) {
    await app.act({type: 'settings.update', patch: {appearance: theme, interfaceScale: 100}}); await sleep(900);
    let s = await app.state();
    await app.act({type: 'tab.navigate', tabId: s.activeTabId, url: base + '/a-' + theme}); await sleep(1200);
    s = await app.state(); const web = s.activeTabId;
    await app.act({type: 'tab.new'}); await sleep(1800);
    s = await app.state(); const ntp = s.activeTabId;
    // 1. new tab -> website (real click on the website's tab)
    let file = path.join(out, `${theme}-select-ntp-to-web.mp4`); let rec = record(file, 1.5); await sleep(1100); await tabEl(web).click(); await rec;
    results.push(analyse(`${theme}-select-ntp-to-web`, file)); await sleep(900);
    // 2. website -> new tab (real click on the new tab's tab)
    file = path.join(out, `${theme}-select-web-to-ntp.mp4`); rec = record(file, 1.5); await sleep(1100); await tabEl(ntp).click(); await rec;
    results.push(analyse(`${theme}-select-web-to-ntp`, file)); await sleep(1800);
    // 3. a navigation from the new tab to a website that answers after 180 ms
    file = path.join(out, `${theme}-navigate-ntp-to-web.mp4`); rec = record(file, 1.6); await sleep(1100); await app.act({type: 'tab.navigate', tabId: ntp, url: base + '/slow-' + theme}); await rec;
    results.push(analyse(`${theme}-navigate-ntp-to-web`, file)); await sleep(600);
    s = await app.state(); results.push({name: `${theme}-state`, ntpNowUrl: s.tabs.find(t => t.id === ntp)?.url, active: s.activeTabId === ntp});
    // close the extra tabs for the next theme
    for (const t of s.tabs.slice(1)) { await app.act({type: 'tab.close', id: t.id}); await sleep(150); }
    await sleep(600);
  }
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(results, null, 1));
} finally {
  try { await app?.close?.(); } catch {}
  server.close();
  try { fss.unlinkSync(slot); } catch {}
}
