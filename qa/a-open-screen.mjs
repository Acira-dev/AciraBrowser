// A: what is ON SCREEN after a click, frame by frame. A hidden capture window (its own session, so the app's permission
// handlers don't apply) records the Acira window through Windows Graphics Capture at 60Hz; the click and every frame are
// stamped on one clock (epoch ms). Prints, per open, the first frame that differs from the pre-click frame inside the
// popup's area and how far each frame has changed, and saves the strip. Isolated, one instance, showInactive, capped.
//   node qa/a-open-screen.mjs <outdir> [light|dark]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const [out, theme = 'light', scaleArg = '100'] = process.argv.slice(2);
const scale = Number(scaleArg); if (!out || ![100,150].includes(scale)) throw Error('outdir and scale 100|150 required');
const report = {theme, scale, cases: []};
await fs.mkdir(out, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Page</title><body style="margin:0;background:#f4f1ea;font:16px system-ui;padding:40px">page</body>`); });
const dir = '.qa-profiles/a-open-screen-' + Date.now();
const app = await startApp({root: dir, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout());
const close = async () => { for (let i = 0; i < 4 && (await layout())?.overlay; i++) { await app.ui.keyboard.press('Escape').catch(() => {}); await sleep(250); } const o = (await layout())?.overlay; if (o) await app.ui.evaluate(id => window.acira.closeOverlay(id), o.id); await sleep(500); };
try {
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; globalThis.__qaTargetWindow=w.id; w.setBounds({x: 60, y: 40, width: 1280, height: 800}); w.showInactive(); });
  await app.act({type: 'settings.update', patch: {appearance: theme, verticalTabs: false, interfaceScale: scale}});
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/a`}); await app.waitWeb(`http://127.0.0.1:${fx.port}/a`); await sleep(1500);
  // The capture window: hidden, its own partition, records the Acira window's media source.
  await app.main(async ({BrowserWindow, BaseWindow, desktopCapturer, session}, capUrl) => {
    const target = BaseWindow.fromId(globalThis.__qaTargetWindow);
    const id = target.getMediaSourceId();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: 0, height: 0}});
    if (!sources.some(s => s.id === id)) throw new Error('acira window not among capture sources');
    const ses = session.fromPartition('qa-open-screen');
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(true)); ses.setPermissionCheckHandler(() => true);
    const cap = new BrowserWindow({show: false, width: 400, height: 300, webPreferences: {session: ses, backgroundThrottling: false, offscreen: false}});
    await cap.loadURL(capUrl); // a secure context (127.0.0.1) so mediaDevices exists
    await cap.webContents.executeJavaScript("document.body.innerHTML = '<video id=v muted autoplay></video>'; 1");
    globalThis.__cap = cap;
    await cap.webContents.executeJavaScript(`(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({audio: false, video: {mandatory: {chromeMediaSource: 'desktop', chromeMediaSourceId: ${JSON.stringify(id)}, maxFrameRate: 60, minFrameRate: 30, maxWidth: 1280, maxHeight: 800}}});
      // Frames are read off the track (a hidden window never renders a <video>); each is stamped when it arrives, an upper
      // bound on when it was on screen.
      window.__frames = []; window.__recording = false;
      const track = stream.getVideoTracks()[0], reader = new MediaStreamTrackProcessor({track}).readable.getReader();
      (async () => { for (let n = 0; n < 3600; n++) { const {value: frame, done} = await reader.read(); if (done) break; if (window.__recording && window.__frames.length < 60) { const c = new OffscreenCanvas(frame.displayWidth, frame.displayHeight); c.getContext('2d').drawImage(frame, 0, 0); const at = performance.timeOrigin + performance.now(); window.__frames.push({at, shown: at, canvas: c}); } frame.close(); } })();
      const settings = track.getSettings();
      return [settings.width, settings.height, settings.frameRate];
    })()`);
  }, `http://127.0.0.1:${fx.port}/capture`);
  const record = async (label, trigger, crop) => {
    await close();
    await app.main(() => globalThis.__cap.webContents.executeJavaScript('window.__frames = []; window.__recording = true; 1'));
    await sleep(120); // a few pre-click frames for the baseline
    const overlayPage = app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
    await overlayPage?.evaluate(() => { const ep = () => performance.timeOrigin + performance.now(); window.__st = {}; if (!window.__stHooked) { window.__stHooked = true; window.acira.subscribeLayout?.(l => { if (l.overlay && window.__st && !window.__st.layout) window.__st.layout = ep(); }); new MutationObserver(() => { if (window.__st && !window.__st.mount && document.querySelector('.sheet-popup')) { window.__st.mount = ep(); requestAnimationFrame(() => { window.__st.raf = ep(); requestAnimationFrame(() => { window.__st.raf2 = ep(); }); }); const vis = (n = 0) => { const sheet = document.querySelector('.sheet-popup'), plane = sheet?.querySelector('.popup-sheet-plane'); let o = 1; for (let e = plane; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden') { o = 0; break; } o *= +cs.opacity; } if (o > .05) { window.__st.visible = ep(); window.__st.pending = sheet?.dataset.sizePending || ''; } else if (n < 60) requestAnimationFrame(() => vis(n + 1)); }; vis(); } }).observe(document.body, {subtree: true, childList: true}); } });
    const uiAt = await app.ui.evaluate(() => { window.__uiSt = {}; return 1; });
    const clickAt = await app.ui.evaluate(trigger);
    await sleep(450);
    const frames = await app.main(async (_, crop) => globalThis.__cap.webContents.executeJavaScript(`(async () => {
      window.__recording = false; const crop = ${JSON.stringify(crop)}; const out = [];
      for (const f of window.__frames) { const ctx = f.canvas.getContext('2d'); const d = ctx.getImageData(crop.x, crop.y, crop.w, crop.h).data; const small = new OffscreenCanvas(crop.w / 2, crop.h / 2); small.getContext('2d').drawImage(f.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w / 2, crop.h / 2); const blob = await small.convertToBlob({type: 'image/png'}); const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192)); out.push({at: f.at, shown: f.shown, sum: (() => { let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i] + d[i + 1] + d[i + 2]; return s; })(), png: btoa(bin)}); }
      return out; })()`), crop);
    const before = frames.filter(f => f.at < clickAt), after = frames.filter(f => f.at >= clickAt);
    const base = before.at(-1)?.sum ?? frames[0]?.sum, final = after.at(-1)?.sum;
    const change = f => final === base ? 0 : Math.round(Math.min(1, Math.abs(f.sum - base) / Math.abs(final - base)) * 100);
    const rows = after.map(f => ({ms: Math.round(f.at - clickAt), changed: change(f)}));
    const st = await overlayPage?.evaluate(() => window.__st).catch(() => null), rel = v => v ? Math.round(v - clickAt) : null;
    if (st) console.log(`   overlay stages: layout +${rel(st.layout)}ms, sheet mounted +${rel(st.mount)}ms, first frame +${rel(st.raf)}ms, plane visible in the renderer +${rel(st.visible)}ms`);
    const firstVisible = rows.find(r => r.changed >= 3);
    console.log(`${theme} ${label}: frames after click ${rows.length} | first visible change at +${firstVisible?.ms ?? '?'}ms | ${rows.slice(0, 14).map(r => `+${r.ms}:${r.changed}%`).join(' ')}`);
    for (const [i, f] of after.slice(0, 16).entries()) await fs.writeFile(path.join(out, `${theme}-${label.replace(/\W+/g, '-')}-${String(i).padStart(2, '0')}-+${Math.round(f.at - clickAt)}ms.png`), Buffer.from(f.png, 'base64'));
    const settled = await overlayPage?.evaluate(() => {
      const plane=document.querySelector('.popup-sheet-plane'),popup=document.querySelector('.browser-popup.popup-content-menu'),scroll=popup?.querySelector('.popup-scroll');
      if(!popup||!scroll)return null;
      return {forming:plane?.hasAttribute('data-forming'),hazeCopies:document.querySelectorAll('[data-vapor-layer]').length,overflow:scroll.scrollHeight-scroll.clientHeight,cue:Number(getComputedStyle(popup,'::after').opacity),fade:getComputedStyle(scroll).getPropertyValue('--menu-scroll-fade').trim(),popupWidth:popup.getBoundingClientRect().width};
    }).catch(() => null);
    report.cases.push({label, clickAt, stages: st, rows, firstVisibleMs:firstVisible?.ms ?? null, settled});
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report,null,2));
    return firstVisible?.ms;
  };
  const menuClick = () => { const b = document.querySelector('[aria-label="Acira menu"]'); const t = performance.timeOrigin + performance.now(); b.click(); return t; };
  const menuCrop = {x: 660, y: 40, w: 620, h: 760};
  // Calibration: the capture path's own latency. A marker painted in the chrome at a stamped moment (no popup involved):
  // the first frame that shows it tells how late this rig sees anything.
  const markerOn = () => { const d = document.createElement('div'); d.id = 'qa-marker'; d.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:28px;background:#f0f;z-index:2147483647'; const t = performance.timeOrigin + performance.now(); document.body.appendChild(d); return t; };
  const calibration = [];
  for (let i = 0; i < 3; i++) { calibration.push(await record(`marker ${i + 1}`, markerOn, {x: 0, y: 0, w: 240, h: 28})); await app.ui.evaluate(() => document.getElementById('qa-marker')?.remove()); await sleep(300); }
  console.log('capture latency, marker painted → first frame showing it (ms):', JSON.stringify(calibration));
  const results = [];
  // A_TRACE=1: a timeline trace of every process across the cold open (written to <outdir>/cold.trace.json).
  const cdp = process.env.A_TRACE ? await app.context.newCDPSession(app.ui) : null, events = [];
  if (cdp) { cdp.on('Tracing.dataCollected', e => events.push(...e.value)); await cdp.send('Tracing.start', {categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,gpu,viz,cc,v8.execute', transferMode: 'ReportEvents'}); }
  for (let i = 0; i < 4; i++) { results.push(await record(`menu ${i === 0 ? 'cold' : 'warm ' + i}`, menuClick, menuCrop)); if (cdp && i === 0) { const done = new Promise(r => cdp.once('Tracing.tracingComplete', r)); await cdp.send('Tracing.end'); await done; await fs.writeFile(path.join(out, 'cold.trace.json'), JSON.stringify(events)); } }
  console.log('first visible change after click (ms):', JSON.stringify(results));
  // The same opens with reduced motion: no condensation ramp, so the first screen change shows the pipeline alone (renderer
  // visible → composited → captured) and anything left over in the signature opens is the designed ramp, not a dead window.
  await app.act({type: 'settings.update', patch: {reducedMotion: true}}); await sleep(800);
  const reduced = [];
  for (let i = 0; i < 3; i++) reduced.push(await record(`menu reduced ${i + 1}`, menuClick, menuCrop));
  console.log('reduced motion, first visible change after click (ms):', JSON.stringify(reduced));
} finally { await app.main(() => globalThis.__cap?.destroy()).catch(() => {}); await app.close(); fx.close?.(); }
