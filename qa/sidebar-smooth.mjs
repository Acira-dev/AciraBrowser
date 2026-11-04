// How smoothly a website follows the docked sidebar opening and closing, measured on the screen's real pixels (macOS).
// A visible window on a throwaway profile; `screencapture -v` records the display (about 60 frames a second) while a real click on the
// sidebar button opens or closes the sidebar. An injected ruler gives the page's own geometry as painted: a green bar at the page's left
// edge and a magenta bar at the middle of its laid-out width (so a re-wrap, a stretch or a gap shows as numbers, not as a guess).
//   ACIRA_BROWSER_TEST_DATA=/tmp/acira-qa/smooth/profile node qa/sidebar-smooth.mjs [outDir]
//   env SM_SITE=https://www.youtube.com/ | newtab | heavy (a local page with an expensive layout; SM_CARDS=2500) | text (long paragraphs that re-wrap at every width; SM_CARDS=1500)  SM_VIEW=full|compact|seamless   SM_REPS=3   SM_LABEL=run   SM_KEEP=1 (keep the clips)
//       ACIRA_DISSOLVE=1 (turns on the page's dissolve, off by default: the page's one re-layout is a cut)   ACIRA_QA_DISSOLVE_TRACE=1 (the picture's timeline in globalThis.__dissolveTrace)
//       SM_ARGS="--flag=value ..." extra Chromium switches   SM_SLOW=4 (the website's thread 4x slower: a mediocre laptop)   ACIRA_QA_LIVE_GOOGLE=1 (a test profile otherwise blocks YouTube)
// Prints one row per transition and the medians: changed frames and fps over the move, the longest stall, how many distinct places the page's
// left edge and its layout took, the ruler's width against its true size (stretch), and where the page ends up.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {_electron} from 'playwright-core';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[sidebar-smooth]', ...a);
const ROOT = path.resolve(process.env.ACIRA_BROWSER_TEST_DATA || ''), OUT = path.resolve(process.argv[2] || '/tmp/acira-qa/smooth/out');
if (!ROOT.startsWith('/tmp/acira-qa/')) throw new Error('ACIRA_BROWSER_TEST_DATA must be a throwaway folder under /tmp/acira-qa/');
const SITE = process.env.SM_SITE || 'https://www.youtube.com/', VIEW = process.env.SM_VIEW || 'full', REPS = Number(process.env.SM_REPS || 3), LABEL = process.env.SM_LABEL || 'run';
const newtab = SITE === 'newtab';
await fs.mkdir(OUT, {recursive: true});
const median = v => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

/** A first start of a profile quits at once to commit its key (qa/prepared-native.mjs does this for .qa-profiles; the same step for a /tmp one). */
async function prepare() {
  await fs.mkdir(ROOT, {recursive: true});
  const nonce = randomUUID(), marker = path.join(ROOT, `native-key-${nonce}.json`), env = {...process.env, ACIRA_PREPARE_PROFILE: ROOT, ACIRA_PREPARE_NONCE: nonce, APPDATA: path.join(ROOT, 'fixture-roaming'), LOCALAPPDATA: path.join(ROOT, 'fixture-local')};
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'), [path.resolve('qa/prepare-native-profile.cjs')], {env, stdio: 'ignore'});
  let result; for (let i = 0; i < 800 && !result; i++) { try { const r = JSON.parse(await fs.readFile(marker, 'utf8')); if (r.nonce === nonce) result = r; } catch {} await sleep(30); }
  if (!result?.ready) throw new Error(result?.error || 'key preparation did not finish');
  for (let i = 0; i < 800; i++) { try { process.kill(result.pid, 0); } catch { break; } await sleep(30); }
  await fs.unlink(marker).catch(() => {}); child.kill();
  return env;
}

/** SM_SITE=heavy: a page whose layout is expensive like a big site's (a grid of SM_CARDS cards that re-wraps at every width), served locally. */
let fixture, target = SITE;
if (SITE === 'text') {
  const {createServer} = await import('node:http'), words = 'the quick brown fox jumps over a lazy dog while seventeen small rivers wander between quiet hills and tall mountains near an old harbour'.split(' ');
  const para = i => { let t = ''; for (let k = 0; k < 70 + i % 40; k++) t += words[(i * 7 + k * 3) % words.length] + ' '; return `<p>${i}. ${t}</p>`; };
  let body = ''; for (let i = 0; i < Number(process.env.SM_CARDS || 1500); i++) body += (i % 4 === 0 ? `<h2>Section ${i / 4}</h2>` : '') + para(i);
  const html = `<!doctype html><title>Text</title><style>body{margin:0;font:17px/1.5 Georgia,serif;background:#fff;color:#111}main{padding:24px 28px}p{margin:0 0 14px}h2{font:700 22px system-ui;margin:22px 0 8px}</style><main>${body}</main>`;
  fixture = createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(html); }); await new Promise(r => fixture.listen(0, '127.0.0.1', r)); target = `http://127.0.0.1:${fixture.address().port}/`;
}
if (SITE === 'heavy') {
  const {createServer} = await import('node:http'), cards = Number(process.env.SM_CARDS || 2500);
  const card = i => `<div class=c><div class=t></div><h3>Card ${i} with a title long enough to wrap onto a second or third line</h3><p>Channel ${i % 97} · ${i * 13 % 900}K views · ${i % 11} days ago</p><ul><li>one<li>two<li>three</ul></div>`;
  const html = `<!doctype html><title>Heavy</title><style>body{margin:0;font:14px system-ui;background:#fff}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;padding:12px}.c{border:1px solid #ddd;border-radius:8px;padding:8px}.t{aspect-ratio:16/9;background:linear-gradient(#9cf,#fc9)}h3{margin:6px 0}ul{display:flex;gap:6px;padding:0;list-style:none}</style><div class=g>${Array.from({length: cards}, (_, i) => card(i)).join('')}</div>`;
  fixture = createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(html); }); await new Promise(r => fixture.listen(0, '127.0.0.1', r)); target = `http://127.0.0.1:${fixture.address().port}/`;
}
const env = await prepare();
let app;
const watchdog = setTimeout(() => { log('watchdog: closing'); void app?.close().catch(() => {}); }, 12 * 60_000); watchdog.unref();

/** screencapture -v for `seconds`; resolves when the file is written. */
function record(file, seconds) {
  const proc = spawn('screencapture', ['-x', '-v', '-V', String(seconds), file], {stdio: 'ignore'});
  return new Promise(resolve => proc.on('exit', resolve));
}

/** Frames of the recording: grey thumbnails of the page area (change from frame to frame) and one full-width row of the ruler. */
function analyse(file, win, scale) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], {encoding: 'utf8'}).stdout.trim().split(',').map(Number);
  const times = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file], {encoding: 'utf8'}).stdout.trim().split('\n').map(Number);
  const [VW] = probe, k = VW / win.screenWidth;           // video pixels per point
  const X = Math.round(win.x * k), Y = Math.round(win.y * k), W = Math.round(win.width * k) & ~1, H = Math.round(win.height * k) & ~1;
  const TW = 192, TH = 96, rowY = Y + Math.round(H * .62);
  const thumb = path.join(OUT, `${LABEL}.thumb.raw`), rows = path.join(OUT, `${LABEL}.rows.raw`);
  const graph = `[0:v]split=2[a][b];[a]crop=${Math.round(W * .55)}:${Math.round(H * .7)}:${X + Math.round(W * .45)}:${Y + Math.round(H * .2)},scale=${TW}:${TH}:flags=area,format=gray[t];[b]crop=${W}:2:${X}:${rowY},format=rgb24[r]`;
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-filter_complex', graph, '-map', '[t]', '-fps_mode', 'passthrough', '-f', 'rawvideo', thumb, '-map', '[r]', '-fps_mode', 'passthrough', '-f', 'rawvideo', rows], {maxBuffer: 1 << 26});
  const tb = Buffer.from(spawnSync('cat', [thumb], {maxBuffer: 1 << 28}).stdout), rb = Buffer.from(spawnSync('cat', [rows], {maxBuffer: 1 << 28}).stdout);
  spawnSync('rm', ['-f', thumb, rows]);
  const n = Math.min(Math.floor(tb.length / (TW * TH)), Math.floor(rb.length / (W * 6)), times.length);
  const diffs = [0]; for (let i = 1; i < n; i++) { let s = 0; const a = i * TW * TH, b = (i - 1) * TW * TH; for (let p = 0; p < TW * TH; p++) s += Math.abs(tb[a + p] - tb[b + p]); diffs.push(s / (TW * TH)); }
  const changed = []; for (let i = 1; i < n; i++) if (diffs[i] > .35) changed.push(i);
  // The burst: the changed frames from the first one on, up to a quiet second.
  let best = [];
  for (const i of changed) { if (best.length && times[i] - times[best[best.length - 1]] > 1) break; best.push(i); }
  if (!best.length) return {error: `no movement in ${n} frames`};
  const first = best[0], last = best[best.length - 1], span = times[last] - times[first];
  let gap = 0; for (let j = 1; j < best.length; j++) gap = Math.max(gap, times[best[j]] - times[best[j - 1]]);
  const ruler = i => { const r = rb.subarray(i * W * 6, i * W * 6 + W * 3); let m0 = -1, m1 = -1, g = -1; for (let x = 0; x < W; x++) { const R = r[x * 3], G = r[x * 3 + 1], B = r[x * 3 + 2]; if (R > 170 && G < 120 && B > 170) { if (m0 < 0) m0 = x; m1 = x; } else if (G > 170 && R < 130 && B < 130 && g < 0) g = x; } return {mid: m0 < 0 ? -1 : (m0 + m1) / 2, bar: m0 < 0 ? 0 : m1 - m0 + 1, green: g}; };
  const series = []; for (let i = Math.max(0, first - 3); i <= Math.min(n - 1, last + 3); i++) series.push({t: times[i] - times[first], ...ruler(i)});
  // The page's laid-out width as painted is twice the distance from its left edge to the middle ruler; its right edge is then 2*mid - green.
  for (const p of series) { p.laid = p.mid >= 0 && p.green >= 0 ? 2 * (p.mid - p.green) : -1; p.right = p.laid >= 0 ? p.green + p.laid : -1; }
  const seenMid = series.filter(p => p.mid >= 0), seenGreen = series.filter(p => p.green >= 0), seenLaid = series.filter(p => p.laid >= 0);
  const rest = median(seenLaid.slice(-3).map(p => p.right)), shortBy = seenLaid.map(p => (rest - p.right) / k), blank = Math.max(0, ...shortBy), cut = Math.max(0, ...shortBy.map(v => -v));
  const steps = (list, key, min) => { let c = 0; for (let i = 1; i < list.length; i++) if (Math.abs(list[i][key] - list[i - 1][key]) >= min) c++; return c; };
  const barNominal = median(seenMid.slice(-3).map(p => p.bar)), stretch = seenMid.length ? Math.max(...seenMid.map(p => Math.abs(p.bar - barNominal))) / Math.max(1, barNominal) : NaN;
  const quiet = changed.filter(i => i < first - 1 || i > last + 1).length, missing = series.filter(p => p.mid < 0).length;
  return {
    frames: best.length, ms: Math.round(span * 1000), fps: Math.round(best.length / Math.max(.016, span)), stallMs: Math.round(gap * 1000), quiet, rulerMissing: missing, of: series.length,
    edgeSteps: steps(seenGreen, 'green', 1), layoutSteps: steps(seenLaid, 'laid', 2), blankPt: Math.round(blank), cutPt: Math.round(cut), stretchPct: Math.round(stretch * 100),
    edge: [seenGreen[0]?.green, seenGreen[seenGreen.length - 1]?.green].join('>'), mid: [seenMid[0]?.mid, seenMid[seenMid.length - 1]?.mid].join('>'), scale: k,
  };
}

const find = (win, match) => win.context().pages().find(p => { try { return p.url().startsWith(match); } catch { return false; } });
try {
  app = await _electron.launch({args: [path.resolve('desktop/main.cjs'), ...(process.env.SM_ARGS ? process.env.SM_ARGS.split(' ') : [])], env, timeout: 40000});
  // Safety: this rig only ever runs a build whose profile is the throwaway folder; anything else (a forgotten ACIRA_BROWSER_TEST_DATA would be the user's own profile) quits before it does a thing.
  { const userData = path.resolve(await app.evaluate(({app: electronApp}) => electronApp.getPath('userData'))); if (!(userData === ROOT || userData.startsWith(ROOT + path.sep)) || !ROOT.startsWith('/tmp/acira-qa/')) { await app.close().catch(() => {}); throw new Error('refusing to run: userData ' + userData + ' is not under ' + ROOT); } }
  const context = app.context(), main = (fn, arg) => app.evaluate(fn, arg);
  let ui; for (let i = 0; i < 300 && !ui; i++) { ui = context.pages().find(p => { try { return p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } }); await sleep(100); }
  for (let i = 0; i < 300; i++) { if (await ui.evaluate(() => Boolean(window.acira?.getSnapshot)).catch(() => false)) break; await sleep(100); }
  try { const skip = ui.getByRole('button', {name: 'Skip setup'}); await skip.waitFor({timeout: 5000}); await skip.click(); await sleep(600); for (let i = 0; i < 100 && await ui.evaluate(() => !!document.querySelector('.fr-stage, .fr-finale-veil, .fr-finale-mark, .fr-ghost')).catch(() => false); i++) await sleep(200); } catch {}
  const act = a => ui.evaluate(a => window.acira.dispatch(a), a), state = () => ui.evaluate(() => window.acira.getSnapshot());
  const display = await main(({screen}) => { const d = screen.getPrimaryDisplay(); return {x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height, scale: d.scaleFactor, hz: d.displayFrequency}; });
  const win = {x: display.x + 40, y: display.y + 60, width: Math.min(1300, display.w - 80), height: Math.min(820, display.h - 120), screenWidth: display.w};
  await main(({BaseWindow}, b) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds(b); w.showInactive(); w.setAlwaysOnTop(true, 'floating'); /* another app's window over this one would hide the move from the screen recording */ }, {x: win.x, y: win.y, width: win.width, height: win.height});
  await act({type: 'settings.update', patch: {style: 'acira', windowView: VIEW, verticalTabs: true, bookmarksBar: false, reducedMotion: false, sidebarWidth: 240}});
  await act({type: 'ui.update', patch: {workspaceOpen: true, webWorkspaceOpen: true}});
  const snap = await state(), tabId = snap.activeTabId;
  log('window view', JSON.stringify({setting: snap.settings.windowView, own: snap.windowUi?.view, vertical: snap.settings.verticalTabs, tabs: snap.tabs.length}));
  if (!newtab) { await act({type: 'tab.navigate', tabId, url: target}); await sleep(9000); }
  else await sleep(1500);
  const web = newtab ? null : find({context: () => context}, new URL(target).origin);
  const inject = () => web?.evaluate(() => { if (document.getElementById('__smm')) return true; const bar = (id, css) => { const e = document.createElement('div'); e.id = id; e.style.cssText = 'all:initial;position:fixed;top:40vh;height:40vh;z-index:2147483647;pointer-events:none;' + css; document.documentElement.append(e); }; bar('__smm', 'left:calc(50% - 5px);width:10px;background:#ff00ff'); bar('__smg', 'left:0;width:8px;background:#00ff00'); window.__smr = []; addEventListener('resize', () => window.__smr.push([Math.round(performance.now()), innerWidth])); return true; }).catch(e => String(e));
  if (web) log('ruler', await inject(), 'title', await web.evaluate(() => document.title).catch(() => '?'));
  // A slower machine: the website's own thread (script, style, layout) runs SM_SLOW times slower.
  if (web && Number(process.env.SM_SLOW) > 1) { const session = await context.newCDPSession(web); await session.send('Emulation.setCPUThrottlingRate', {rate: Number(process.env.SM_SLOW)}); log('page thread throttled', process.env.SM_SLOW + 'x'); }
  // Seamless has no docked sidebar button: its docked state is the pinned side edge (Ctrl+Shift+E).
  const pin = on => ui.evaluate(c => window.acira.browserCommand(c), {type: 'edge', tabId, pin: {zone: 'side', on}});
  if (VIEW === 'seamless') { await pin(true); await sleep(1500); }
  const toggle = async step => {
    if (VIEW === 'seamless') return pin(step === 'open');
    const at = await ui.evaluate(() => { const b = [...document.querySelectorAll('.sidebar-toggle-control')].map(e => e.getBoundingClientRect()).find(r => r.width > 0 && r.left >= 0 && r.left < innerWidth); return b ? {x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2)} : null; });
    if (!at) throw new Error('no sidebar button');
    return main(({webContents}, p) => { const u = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); u.sendInputEvent({type: 'mouseMove', x: p.x, y: p.y}); u.sendInputEvent({type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1}); u.sendInputEvent({type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1}); return true; }, at);
  };
  // setBounds calls on the website's view: how many and when.
  await main(({BaseWindow}) => { globalThis.__smB = []; const walk = v => [v, ...(v.children || []).flatMap(walk)]; for (const v of walk(BaseWindow.getAllWindows()[0].contentView)) { if (!v.webContents || v.__smOrig) continue; let u = ''; try { u = v.webContents.getURL(); } catch {} if (!/^https?:/.test(u)) continue; v.__smOrig = v.setBounds; v.setBounds = function (b) { globalThis.__smB.push([Math.round(performance.now()), b.x, b.width]); return v.__smOrig(b); }; v.__smGet = () => v.getBounds(); globalThis.__smV = v; } });
  const pageBounds = () => main(() => globalThis.__smV?.getBounds());
  const open0 = await pageBounds(); log('display', JSON.stringify(display), 'page view at rest (open)', JSON.stringify(open0));
  const results = [];
  // Rep -1 is a warm-up (the first moves after a load are slow for any page) and is left out of the numbers.
  for (let rep = -1; rep < REPS; rep++) for (const step of ['close', 'open']) {
    await sleep(500);
    const file = path.join(OUT, `${LABEL}-${VIEW}-${newtab ? 'newtab' : 'site'}-${step}-${rep + 1}.mov`);
    await main(() => { globalThis.__smB.length = 0; });
    if (web) await web.evaluate(() => { window.__smr.length = 0; }).catch(() => {});
    const done = record(file, 4); await sleep(1700);
    const t0 = await main(() => Math.round(performance.now())); await toggle(step);
    await done;
    const moves = await main(() => globalThis.__smB.slice()), resizes = web ? await web.evaluate(() => window.__smr.slice()).catch(() => []) : [];
    const at = await pageBounds(), m = analyse(file, win, display.scale), inner = web ? await web.evaluate(() => innerWidth).catch(() => -1) : -1;
    // How steadily main itself placed the page: the longest wait between two placements.
    let placeGap = 0; for (let i = 1; i < moves.length; i++) placeGap = Math.max(placeGap, moves[i][0] - moves[i - 1][0]);
    const row = {step, rep, ...m, placeGapMs: Math.round(placeGap), innerWidth: inner, exact: web ? inner === at?.width : undefined, setBounds: moves.length, widths: new Set(moves.map(b => b[2])).size, pageResizes: resizes.length, pageWidths: new Set(resizes.map(r => r[1])).size, bounds: at ? `${at.x},${at.y},${at.width},${at.height}` : '', t0};
    log(rep < 0 ? 'warm-up' : '', JSON.stringify(row)); if (rep >= 0) results.push(row);
    if (process.env.SM_KEEP !== '1') await fs.rm(file, {force: true});
  }
  // Rest geometry: every close ends where the first one did, every open back at the starting bounds.
  const ends = step => [...new Set(results.filter(r => r.step === step).map(r => r.bounds))];
  if (web) log('final layout exact (the page\'s own width equals its view\'s, after every move):', results.every(r => r.exact) ? 'yes' : 'NO ' + JSON.stringify(results.filter(r => !r.exact).map(r => [r.step, r.rep, r.innerWidth, r.bounds])));
  log('rest bounds after close', ends('close').join(' | '), '— after open', ends('open').join(' | '), '(started', `${open0?.x},${open0?.y},${open0?.width},${open0?.height})`);
  const table = []; for (const step of ['close', 'open']) { const rows = results.filter(r => r.step === step && !r.error); table.push({step, fps: median(rows.map(r => r.fps)), frames: median(rows.map(r => r.frames)), ms: median(rows.map(r => r.ms)), stallMs: median(rows.map(r => r.stallMs)), worstStall: Math.max(0, ...rows.map(r => r.stallMs)), edgeSteps: median(rows.map(r => r.edgeSteps)), layoutSteps: median(rows.map(r => r.layoutSteps)), blankPt: Math.max(0, ...rows.map(r => r.blankPt || 0)), cutPt: Math.max(0, ...rows.map(r => r.cutPt || 0)), stretchPct: Math.max(0, ...rows.map(r => r.stretchPct || 0)), setBounds: median(rows.map(r => r.setBounds)), pageWidths: median(rows.map(r => r.pageWidths))}); }
  log(`=== ${LABEL} ${VIEW} ${newtab ? 'newtab' : SITE} (medians over ${REPS})`); console.table(table);
  await fs.writeFile(path.join(OUT, `${LABEL}-${VIEW}-${newtab ? 'newtab' : 'site'}.json`), JSON.stringify({display, table, results}, null, 1));
} finally { clearTimeout(watchdog); try { await app?.close(); } catch {} fixture?.close(); }
