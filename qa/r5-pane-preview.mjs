// Pane drag live layout preview (R5, real app; real input through sendInputEvent on the interface view, the OS cursor never moves):
//   1. strip: a pane of a three-column split dragged across three zones (an edge, another edge, a middle swap) and released on a fourth; the interface view
//      is captured continuously (capturePage, as fast as it goes, timestamps kept) and every animation frame logs the frames' and panes' boxes, so the re-flows
//      and the drop can be measured: the last preview frame must equal the panes after the drop (±1 px), with no jump in between.
//   2. Esc: a drag onto a zone, then Esc: the frames glide back to their own boxes.
//   3. pill: from the panes up to the "Drag up here for layouts" pill: the pill lights by distance, the carried chip joins it (liquid), then the card comes.
//   4. sample (SAMPLE=1): for each zone of a 3- and a 4-pane layout (the last pane onto every region of every other pane) the frames' boxes just before the
//      release vs the panes' boxes after it.
//   node qa/r5-pane-preview.mjs <tag> [dark|light] [1|1.5]   (cwd = worktree root; one native slot, one Electron app, closed in finally; 4 tabs; bounded loops)
// Evidence: C:/ae/r6/panepreview/evidence/<tag>/ (results.json, rects-*.json, strip-*/ frames + sheet PNGs)
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = process.cwd(), tag = process.argv[2] || 'run', THEME = process.argv[3] || 'dark', DSF = Number(process.argv[4] || 1);
const OUT = path.join('C:/ae/r6/panepreview/evidence', tag); await fs.mkdir(OUT, { recursive: true });
const PROFILES = 'C:/ae/r6/panepreview/profiles';
const results = [], log = (...a) => console.log('[qa]', ...a);
const check = (ok, label, extra) => { results.push({ ok: !!ok, label, ...(extra ? { extra } : {}) }); log(ok ? 'PASS' : 'FAIL', label); };

async function slot() {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) { const f = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.write(`r5-pane-preview ${tag} ${new Date().toISOString()}`); await h.close(); return f; } catch {} }
    await sleep(30000);
  }
  throw Error('no slot');
}
async function launch() {
  const req = createRequire(path.join(root, 'package.json'));
  const { _electron } = req('playwright'); const electronExe = req('electron');
  const profile = path.join(PROFILES, 'pp-' + Date.now());
  const roaming = path.join(profile, 'fixture-roaming'), local = path.join(profile, 'fixture-local');
  await fs.mkdir(roaming, { recursive: true }); await fs.mkdir(local, { recursive: true });
  const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: profile, APPDATA: roaming, LOCALAPPDATA: local };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV; delete env.ACIRA_BROWSER_TEST_HIDDEN;
  const nonce = randomUUID(), marker = path.join(profile, 'native-key-' + nonce + '.json');
  const child = spawn(electronExe, [path.join(root, 'qa/prepare-native-profile.cjs')], { env: { ...env, ACIRA_PREPARE_PROFILE: profile, ACIRA_PREPARE_NONCE: nonce }, windowsHide: true, stdio: 'ignore', cwd: root });
  const until = Date.now() + 25000; let result;
  while (Date.now() < until) { try { result = JSON.parse(await fs.readFile(marker, 'utf8')); if (result.nonce === nonce) break; } catch {} await sleep(50); }
  if (!result?.ready) { try { child.kill(); } catch {} throw Error(result?.error || 'native key prep failed'); }
  while (Date.now() < until) { try { process.kill(result.pid, 0); } catch { break; } await sleep(50); }
  await fs.unlink(marker).catch(() => {});
  const args = [path.join(root, 'desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  if (DSF !== 1) args.push(`--force-device-scale-factor=${DSF}`);
  return _electron.launch({ executablePath: electronExe, cwd: root, timeout: 40000, env, args });
}

const pages = { one: ['Alpha', '#f6e3e3'], two: ['Bravo', '#f8ecdc'], three: ['Charlie', '#e1ecfb'], four: ['Delta', '#e9eee3'] };
const server = http.createServer((req, res) => { const k = req.url.slice(1) || 'one', [title, bg] = pages[k] || ['Page', '#fff']; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>${title}</title><body style="margin:0;background:${bg};font:600 28px system-ui;color:#222;display:grid;place-items:center;height:100vh">${title}`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const UI = 'acira-browser-ui://ui/index.html';
let app, ui, lock, pointer = { x: 0, y: 0 };
const uiPage = async () => { for (let i = 0; i < 300; i++) { const p = app.context().pages().find(p => { try { return p.url() === UI; } catch { return false; } }); if (p) return p; await sleep(100); } throw Error('ui page not found'); };
const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
const state = () => ui.evaluate(() => window.acira.getSnapshot());
const split = async () => (await state()).windowUi.split;
const focusWin = () => app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.show(); w.focus(); } });
const input = event => app.evaluate(({ webContents }, event) => { webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html')?.sendInputEvent(event); }, event);
const mouse = (type, x, y) => input({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : {}) });
const key = async k => { await input({ type: 'keyDown', keyCode: k }); await input({ type: 'keyUp', keyCode: k }); };
const box = sel => ui.evaluate(sel => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, sel);
const waitFor = async (fn, label, ms = 6000) => { const end = Date.now() + ms; let v; do { v = await fn(); if (v) return v; await sleep(50); } while (Date.now() < end); throw Error('timeout ' + label); };
const paneBoxes = () => ui.evaluate(() => Object.fromEntries([...document.querySelectorAll('.page-area .split-pages [data-pane]')].map(n => { const r = n.getBoundingClientRect(), l = n.querySelector('.split-label')?.getBoundingClientRect(); return [n.dataset.pane, { x: r.x, y: r.y, w: r.width, h: r.height, ribbon: l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null }]; })));
const frameBoxes = () => ui.evaluate(() => Object.fromEntries([...document.querySelectorAll('.split-drag-layer .split-drag-frame[data-pane]')].map(n => { const r = n.getBoundingClientRect(); return [n.dataset.pane, { x: r.x, y: r.y, w: r.width, h: r.height }]; })));
const diff = (a, b) => { let worst = 0; for (const id of Object.keys(b)) { const p = a[id], q = b[id]; if (!p) return Infinity; worst = Math.max(worst, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.w - q.w), Math.abs(p.h - q.h)); } return worst; };
async function glide(x, y, steps = 14, wait = 16) { const from = pointer; for (let i = 1; i <= steps; i++) { await mouse('mouseMove', from.x + (x - from.x) * i / steps, from.y + (y - from.y) * i / steps); await sleep(wait); } pointer = { x, y }; }
async function pressRibbon(b) {
  const x = b.ribbon.x + Math.min(70, b.ribbon.w / 3), y = b.ribbon.y + b.ribbon.h / 2; pointer = { x, y };
  await mouse('mouseMove', x, y); await sleep(40); await mouse('mouseDown', x, y); await sleep(30);
  await glide(x + 6, y + 16, 3, 16);
}
async function arrange(layout, order) {
  const now = await split();
  if (!now || now.tabIds.length !== order.length) { await act({ type: 'split.close' }); await sleep(400); await act({ type: 'tab.select', id: order[0] }); await act({ type: 'split.open', tabIds: order, layout }); }
  else if (now.layout !== layout || now.tabIds.join() !== order.join()) await act({ type: 'split.arrange', layout, order });
  await waitFor(async () => { const s = await split(); return s && s.layout === layout && s.tabIds.join() === order.join(); }, 'arranged ' + layout);
  await waitFor(async () => Object.keys(await paneBoxes()).length === order.length, 'pane boxes');
  await sleep(700);
}
const aim = (b, where) => where === 'left' ? { x: b.x + b.w * .1, y: b.y + b.h * .55 } : where === 'right' ? { x: b.x + b.w * .9, y: b.y + b.h * .55 } : where === 'top' ? { x: b.x + b.w * .5, y: b.y + Math.max(b.h * .12, 110) } : where === 'bottom' ? { x: b.x + b.w * .5, y: b.y + b.h * .9 } : { x: b.x + b.w * .5, y: b.y + b.h * .55 };

/** Starts the capture loop in the main process (the interface view, as fast as capturePage goes) and the per-frame box probe in the interface. */
async function recordStart() {
  await ui.evaluate(() => {
    const sink = globalThis.__rectLog = [], t0 = performance.now(); globalThis.__rectOn = true; globalThis.__aciraPaneDragProbe = [];
    const read = sel => Object.fromEntries([...document.querySelectorAll(sel)].map(n => { const r = n.getBoundingClientRect(); return [n.dataset.pane, { x: r.x, y: r.y, w: r.width, h: r.height }]; }));
    const tick = () => { if (!globalThis.__rectOn || sink.length > 3000) return; const pill = document.querySelector('.split-picker-dock-hint'), liquid = document.querySelector('.liquid-layer');
      sink.push({ t: Math.round((performance.now() - t0) * 10) / 10, frames: read('.split-drag-layer .split-drag-frame[data-pane]'), panes: read('.page-area .split-pages [data-pane]'), phase: document.querySelector('.split-drag-layer')?.dataset.phase ?? null, card: Boolean(document.querySelector('.split-picker-card')), reach: pill ? Number(pill.style.getPropertyValue('--reach') || 0) : null, liquid: liquid ? getComputedStyle(liquid).visibility === 'visible' : false });
      requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  // capturePage of the interface view (half size, or a full-size crop), two captures in flight so the readbacks overlap; encoded after the run.
  const view = await ui.evaluate(() => innerWidth);
  await app.evaluate(({ webContents }, [crop, view]) => {
    const wc = webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html');
    globalThis.__strip = []; globalThis.__stripOn = true; const t0 = Date.now();
    const worker = async () => { while (globalThis.__stripOn && globalThis.__strip.length < 480) { try { const image = crop ? await wc.capturePage({ x: Math.round(crop.x), y: Math.round(crop.y), width: Math.round(crop.w), height: Math.round(crop.h) }) : await wc.capturePage(); const t = Date.now() - t0; globalThis.__strip.push({ t, img: crop ? image : image.resize({ width: Math.round(view / 2), quality: 'good' }) }); } catch { break; } } };
    void worker(); setTimeout(() => void worker(), 8);
    globalThis.__stripStop = () => { globalThis.__stripOn = false; globalThis.__strip.sort((a, b) => a.t - b.t); };
  }, [recordCrop, view]);
}
let recordCrop = null;
async function recordStop(name) {
  const rects = await ui.evaluate(() => { globalThis.__rectOn = false; return { rects: globalThis.__rectLog, probe: globalThis.__aciraPaneDragProbe }; });
  const dir = path.join(OUT, `strip-${name}`); await fs.mkdir(dir, { recursive: true });
  const meta = await app.evaluate(async ({}) => { globalThis.__stripStop?.(); await new Promise(r => setTimeout(r, 60)); return globalThis.__strip.sort((a, b) => a.t - b.t).map(f => ({ t: f.t, b64: f.img.toJPEG(86).toString('base64') })); });
  for (let i = 0; i < meta.length; i++) await fs.writeFile(path.join(dir, `f${String(i).padStart(3, '0')}-${meta[i].t}ms.jpg`), Buffer.from(meta[i].b64, 'base64'));
  const gaps = meta.slice(1).map((f, i) => f.t - meta[i].t), mean = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
  await fs.writeFile(path.join(OUT, `rects-${name}.json`), JSON.stringify(rects, null, 0));
  // A contact sheet of the strip (every frame that changed, up to 48) composed in the interface's own canvas.
  const pick = meta.filter((_, i) => i % Math.max(1, Math.ceil(meta.length / 48)) === 0).slice(0, 48);
  const sheet = await ui.evaluate(async frames => {
    const imgs = await Promise.all(frames.map(f => createImageBitmap(new Blob([Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))], { type: 'image/jpeg' }))));
    if (!imgs.length) return null; const w = imgs[0].width < 600 ? imgs[0].width : 400, h = Math.round(imgs[0].height * w / imgs[0].width), cols = 6, rows = Math.ceil(imgs.length / cols);
    const canvas = new OffscreenCanvas(cols * w, rows * (h + 18)), g = canvas.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, canvas.width, canvas.height); g.font = '12px system-ui'; g.fillStyle = '#ddd';
    imgs.forEach((img, i) => { const x = (i % cols) * w, y = Math.floor(i / cols) * (h + 18); g.drawImage(img, x, y + 16, w, h); g.fillText(`${frames[i].t} ms`, x + 4, y + 12); });
    const blob = await canvas.convertToBlob({ type: 'image/png' }); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s);
  }, pick.map(f => ({ t: f.t, b64: f.b64 })));
  if (sheet) await fs.writeFile(path.join(OUT, `sheet-${name}.png`), Buffer.from(sheet, 'base64'));
  log(`strip ${name}: ${meta.length} captures, mean gap ${mean.toFixed(1)} ms; ${rects.rects.length} box samples`);
  return { frames: meta.length, meanGap: mean, rects: rects.rects, probe: rects.probe };
}
async function shot(name) {
  const b64 = await app.evaluate(async ({ webContents }) => { const wc = webContents.getAllWebContents().find(x => x.getURL() === 'acira-browser-ui://ui/index.html'); return (await wc.capturePage()).toPNG().toString('base64'); });
  await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64'));
}

/** 1 + 2: three zones, re-flow each time, then a drop; and an Esc glide back. */
async function stripScenario(ids) {
  const order = ids.slice(0, 3); await arrange('three-columns', order);
  const before = await paneBoxes(), [A, B, C] = order;
  await recordStart();
  await pressRibbon(before[C]); await sleep(260);
  const zones = [['A.left', aim(before[A], 'left')], ['B.top', aim(before[B], 'top')], ['A.centre', aim(before[A], 'centre')], ['B.bottom', aim(before[B], 'bottom')]];
  const seen = [];
  for (const [name, p] of zones) { await glide(p.x, p.y, 16, 16); await sleep(380); const frames = await frameBoxes(), probe = await ui.evaluate(() => globalThis.__aciraPaneDragProbe?.at(-1)); seen.push({ name, preview: probe?.preview, frames }); if (seen.length === 2) await shot(`zone-${name}`); }
  const lastFrames = seen.at(-1).frames;
  await mouse('mouseUp', pointer.x, pointer.y);
  await sleep(1100);
  const strip = await recordStop('reflow-drop'), after = await paneBoxes(), sp = await split();
  const keys = seen.map(s => s.preview);
  check(new Set(keys).size === keys.length && keys.every(Boolean), `three zones (and a fourth) each re-flow to their own arrangement: ${keys.join(' | ')}`);
  // Re-flows: a frame box changes between consecutive zones.
  const moved = seen.slice(1).map((s, i) => diff(s.frames, seen[i].frames));
  check(moved.every(d => d > 20), `every zone change moved the frames (${moved.map(d => d.toFixed(0)).join(', ')} px)`);
  const drop = diff(lastFrames, after);
  check(drop <= 1, `drop: the panes land where the last preview frame showed them (worst ${drop.toFixed(2)} px)`, { lastFrames, after, split: sp });
  // No jump: from the release to the end of the drop hold, every logged frame box stays where it was.
  const holds = strip.rects.filter(r => r.phase === 'drop'), jumps = holds.map(r => diff(r.frames, lastFrames)), afterLayer = strip.rects.filter(r => !Object.keys(r.frames).length && r.t > (holds.at(-1)?.t ?? 0));
  check(holds.length > 0 && Math.max(...jumps) <= 1, `while the drop holds (${holds.length} frames) the frames never move (max ${Math.max(0, ...jumps).toFixed(2)} px)`);
  const settledPanes = afterLayer.length ? diff(afterLayer[0].panes, lastFrames) : Infinity;
  check(settledPanes <= 1, `first frame after the layer: the panes are where the frames were (worst ${settledPanes.toFixed(2)} px)`);
  results.push({ ok: true, label: 'strip stats', extra: { captures: strip.frames, meanGapMs: Number(strip.meanGap.toFixed(1)), boxSamples: strip.rects.length } });
  // 2: Esc glides back.
  const now = await paneBoxes(); await recordStart();
  const ids2 = Object.keys(now); const dragged = ids2[ids2.length - 1], other = ids2[0];
  await pressRibbon(now[dragged]); await sleep(200); const p = aim(now[other], 'left'); await glide(p.x, p.y, 14, 16); await sleep(380);
  const out = await frameBoxes();
  await key('Escape'); await sleep(900); await mouse('mouseUp', pointer.x, pointer.y); await sleep(300);
  const esc = await recordStop('esc-back'), backs = esc.rects.filter(r => r.phase === 'back'), home = backs.at(-1)?.frames ?? {};
  check(diff(out, now) > 20 && diff(home, now) <= 1, `Esc: the frames were out (${diff(out, now).toFixed(0)} px) and glide back home (${diff(home, now).toFixed(2)} px) over ${backs.length} frames`);
  const unchanged = await split(); check(unchanged.tabIds.join() === sp.tabIds.join() && unchanged.layout === sp.layout, 'Esc changes nothing');
}

/** 3: up to the pill — glow, liquid, card. */
async function pillScenario(ids) {
  const order = ids.slice(0, 3); await arrange('three-columns', order);
  const before = await paneBoxes(), area = await box('.page-area');
  // Full-size crop round the pill (its approach, glow, the liquid and the card).
  recordCrop = { x: area.x + area.w / 2 - 260, y: area.y - 8, w: 520, h: 200 }; await recordStart(); recordCrop = null;
  await pressRibbon(before[order[2]]); await sleep(150);
  await glide(area.x + area.w / 2, area.y + 420, 14, 16); await sleep(200);
  await glide(area.x + area.w / 2, area.y + 120, 24, 16);
  await glide(area.x + area.w / 2, area.y + 62, 16, 22); await sleep(260);
  await glide(area.x + area.w / 2, area.y + 44, 8, 30); await sleep(260);
  await glide(area.x + area.w / 2, area.y + 30, 6, 30); await sleep(500);
  await shot('pill-card');
  await key('Escape'); await sleep(500); await mouse('mouseUp', pointer.x, pointer.y); await sleep(300);
  const rec = await recordStop('pill');
  const reach = rec.rects.filter(r => r.reach !== null).map(r => r.reach), rose = reach.length && Math.max(...reach) > .9 && reach[0] < .05;
  const firstLiquid = rec.rects.findIndex(r => r.liquid), firstCard = rec.rects.findIndex(r => r.card);
  check(rose, `the pill lights as the pointer nears it (reach ${reach[0]?.toFixed(2)} → ${Math.max(0, ...reach).toFixed(2)})`);
  check(firstLiquid >= 0 && firstCard > firstLiquid, `liquid joins the chip and the pill before the card comes (liquid at ${rec.rects[firstLiquid]?.t} ms, card at ${rec.rects[firstCard]?.t} ms)`);
  check(firstCard >= 0, 'the card comes once the chip reaches the pill');
}

/** 4: frames just before the release vs panes after it, for every zone of the dragged (last) pane. */
async function sampleScenario(ids) {
  const rows = [];
  for (const [layout, n] of [['three-columns', 3], ['left-one-right-two', 3], ['grid', 4], ['top-one-bottom-three', 4]]) {
    const order = ids.slice(0, n), dragged = order[n - 1];
    for (const target of order.slice(0, n - 1)) for (const where of ['left', 'right', 'top', 'bottom', 'centre']) {
      await arrange(layout, order);
      const before = await paneBoxes();
      await ui.evaluate(() => { globalThis.__aciraPaneDragProbe = []; });
      await pressRibbon(before[dragged]); await sleep(120);
      const p = aim(before[target], where); await glide(p.x, p.y, 12, 16); await sleep(420);
      const shown = await frameBoxes(), probe = await ui.evaluate(() => globalThis.__aciraPaneDragProbe?.at(-1));
      await mouse('mouseUp', pointer.x, pointer.y); await sleep(900);
      const after = await paneBoxes(), off = diff(shown, after), sp = await split();
      rows.push({ layout, target, where, preview: probe?.preview ?? '', result: `${sp.layout}:${sp.tabIds.join(',')}`, off: Number(off.toFixed(3)) });
      log(off <= 1 ? 'ok ' : 'MISMATCH', layout, where, 'off', off.toFixed(2), probe?.preview || '(no zone)');
    }
  }
  await fs.writeFile(path.join(OUT, 'sample.json'), JSON.stringify(rows, null, 1));
  const zoned = rows.filter(r => r.preview), worst = Math.max(0, ...rows.map(r => r.off));
  check(rows.every(r => r.off <= 1), `real app: frames before the release = panes after it for ${rows.length} drops (${zoned.length} on a zone), worst ${worst.toFixed(2)} px`);
  check(zoned.every(r => r.preview === r.result), 'each release left exactly the arrangement the preview showed');
}

try {
  lock = await slot(); log('slot', lock);
  app = await launch();
  ui = await uiPage(); await ui.waitForLoadState('domcontentloaded');
  const W = DSF === 1 ? 1640 : 1240, H = DSF === 1 ? 960 : 720;
  await app.evaluate(({ BaseWindow }, [w, h]) => { for (const win of BaseWindow.getAllWindows()) if (win.isVisible()) { win.setContentSize(w, h); win.setPosition(30, 20); } }, [W, H]);
  await focusWin();
  const skip = ui.getByRole('button', { name: 'Skip setup' }); await skip.first().waitFor({ timeout: 20000 }).catch(() => {}); if (await skip.count()) await skip.first().click({ timeout: 5000 }).catch(() => {});
  await sleep(1800); ui = await uiPage();
  const done = ui.getByRole('button', { name: /^Done$/ }); if (await done.count()) { await done.first().click().catch(() => {}); await sleep(700); }
  await focusWin();
  await act({ type: 'settings.update', patch: { appearance: THEME, verticalTabs: false, interfaceScale: 100 } }); await sleep(1000);
  const first = (await state()).activeTabId; await act({ type: 'tab.navigate', tabId: first, url: base + 'one' });
  for (const n of ['two', 'three', 'four']) await act({ type: 'tab.new', url: base + n, background: true });
  await waitFor(async () => (await state()).tabs.length === 4, 'four tabs'); await sleep(1200);
  for (const tab of (await state()).tabs) { await act({ type: 'tab.select', id: tab.id }); await sleep(800); }
  await act({ type: 'tab.select', id: first }); await sleep(600);
  const ids = (await state()).tabs.map(t => t.id);
  log('page area', JSON.stringify(await box('.page-area')), 'dpr', await ui.evaluate(() => devicePixelRatio));
  await stripScenario(ids).catch(error => check(false, 'strip scenario: ' + (error?.stack || error)));
  await pillScenario(ids).catch(error => check(false, 'pill scenario: ' + (error?.stack || error)));
  if (process.env.SAMPLE) await sampleScenario(ids).catch(error => check(false, 'sample scenario: ' + (error?.stack || error)));
} catch (error) {
  check(false, 'script error: ' + (error?.stack || error));
} finally {
  try { await app?.close(); } catch {}
  try { server.close(); } catch {}
  if (lock) await fs.unlink(lock).catch(() => {});
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter(r => !r.ok); log(`${results.length - failed.length}/${results.length} passed`); for (const f of failed) log('  FAILED:', f.label);
  process.exit(failed.length ? 1 : 0);
}
