// R4 final key-screen screenshots for the founder's report: REAL pixels of the whole window (desktopCapturer), one fresh isolated profile,
// dark, 100%, window content 1440x900 (DIPs). One run, one native slot (C:\ae\slot-N.lock, wx, released in finally), one Electron.
//   node qa/r4-final-shots.mjs [outDir]        default C:/ae/r4/final-shots
// 01 setup welcome   02 setup cover step   03 sidebar tabs + 2-pane split   04 main menu (View / Tabs rows)   05 Settings > Appearance (Layout)
// 06 fixture search page with the Preview chip   07 Seamless: sidebar floating over Settings (real OS cursor)   08 "Close Acira?" card
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {startApp, httpFixture, sleep, poll, finaleEnded} from './d-harness.mjs';
const require = createRequire(import.meta.url);
const {page: serp} = require('../tests/fixtures/search-preview/pages.cjs');
process.env.D_VISIBLE = '1';
const OUT = path.resolve(process.argv[2] || 'C:/ae/r4/final-shots');
await fs.mkdir(OUT, {recursive: true});
const report = [];
const note = (...a) => { const line = a.join(' '); report.push(line); console.log(line); };

async function takeSlot() {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) { const file = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(file, 'wx'); await h.writeFile(`r4-final-shots ${new Date().toISOString()}`); await h.close(); return file; } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    await sleep(15000);
  }
  throw new Error('no native slot');
}
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function icon(hex) { // a round coloured 32x32 favicon
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), size = 32, rows = [];
  for (let y = 0; y < size; y++) { const row = Buffer.alloc(1 + size * 4); for (let x = 0; x < size; x++) { const o = 1 + x * 4; row[o] = r; row[o + 1] = g; row[o + 2] = b; row[o + 3] = Math.hypot(x - 15.5, y - 15.5) < 14.5 ? 255 : 0; } rows.push(row); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
// Local stand-in sites (never a real site): a title, an accent colour, a hero block and some copy.
const SITES = {
  notes: ['Field notes', '#e5484d', '#fbf3ef', 'Small observations from slow walks, written down before they fade.'],
  atlas: ['Atlas of quiet places', '#3b82f6', '#eef4fc', 'A growing map of benches, libraries and rooftops where nothing is asked of you.'],
  journal: ['The Slow Journal', '#30a46c', '#eef7f1', 'Essays on making less, better, and on finishing the thing you started.'],
  studio: ['Studio Hale: ceramics', '#f5a524', '#fdf6e8', 'Hand-thrown bowls, cups and plates, glazed in small batches each season.'],
  orbit: ['Orbit: weather for planets', '#8e4ec6', '#f3edf9', 'Seven-day forecasts for places you will probably never visit.'],
  recipes: ['Recipes by Sol', '#12a594', '#e9f6f4', 'Weeknight dinners that taste like effort and take about twenty minutes.'],
  library: ['Library of small things', '#ec4899', '#fcedf4', 'A catalogue of ordinary objects, each with a short story attached.'],
};
const page = ([title, accent, tint, blurb]) => `<!doctype html><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/favicon.png"><style>
body{margin:0;font:17px/1.65 Georgia,serif;background:${tint};color:#1d1d1f}
header{padding:56px 64px 40px;background:linear-gradient(135deg,${accent}22,${accent}08)}
h1{font:700 52px/1.1 system-ui,sans-serif;margin:0 0 14px;letter-spacing:-.02em}
.lead{font:400 22px/1.5 system-ui,sans-serif;max-width:640px;margin:0;color:#444}
.chip{display:inline-block;margin-top:22px;padding:9px 18px;border-radius:999px;background:${accent};color:#fff;font:600 15px system-ui,sans-serif}
main{padding:36px 64px;max-width:760px}
p{margin:0 0 18px}
.card{margin:26px 0;padding:22px 26px;border-radius:16px;background:#fff;border:1px solid ${accent}33}
</style><header><h1>${title}</h1><p class="lead">${blurb}</p><span class="chip">Read more</span></header><main>
<p>Every page here is a local stand-in used to photograph the browser. The text is only here to give the page some weight on screen.</p>
<div class="card"><b>Latest</b><p>Light falls at a different angle in the afternoon, and the whole room changes its mind about what it is for.</p></div>
<p>Nothing on this page loads from the network, so what you see in the window is the browser and nothing else.</p></main>`;
const fx = await httpFixture((req, res) => {
  const host = (req.headers.host || '').split('.')[0], site = SITES[host];
  if (req.url.startsWith('/favicon')) { res.setHeader('content-type', 'image/png'); res.end(icon(site ? site[1] : '#888888')); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (site) { res.end(page(site)); return; }
  const m = /^\/acira-serp\/([a-z]+)\/search$/.exec(new URL(req.url, 'http://x').pathname);
  if (m) { const u = new URL(req.url, 'http://x'); res.end(serp(m[1], {theme: u.searchParams.get('theme') || 'dark', dest: i => `http://orbit.localhost:${fx.port}/result-${i}`})); return; }
  res.statusCode = 404; res.end('no');
});
const base = name => `http://${name}.localhost:${fx.port}`;

// The real OS cursor (the Seamless edge controller reads the screen's cursor point, so synthetic input proves nothing).
function cursorMover() {
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Cur { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); }
"@
[Cur]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) { $l = [Console]::In.ReadLine(); if ($l -eq $null -or $l -eq 'q') { break }; $p = $l.Split(' '); [Cur]::SetCursorPos([int]$p[0], [int]$p[1]) | Out-Null; [Console]::Out.WriteLine('ok'); [Console]::Out.Flush() }
`], {stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true});
  let buffer = '', waiters = [];
  ps.stdout.on('data', d => { buffer += d; let i; while ((i = buffer.indexOf('\n')) >= 0) { buffer = buffer.slice(i + 1); waiters.shift()?.(); } });
  const ready = new Promise(r => waiters.push(r));
  return {ready, move: (x, y) => new Promise(r => { waiters.push(r); ps.stdin.write(`${Math.round(x)} ${Math.round(y)}\n`); }), close: () => { try { ps.stdin.write('q\n'); } catch {} setTimeout(() => { try { ps.kill(); } catch {} }, 500); }};
}

let slot, t, mover;
const watchdog = setTimeout(() => { console.error('watchdog: closing'); try { void t?.close(); } catch {} }, 9 * 60 * 1000); watchdog.unref();
/** Real pixels of the whole window: raise it, focus it (the glass is opaque when inactive), grab it through the OS window capture. */
async function shot(file) {
  const b64 = await t.main(async ({BaseWindow, desktopCapturer, screen}) => {
    const win = BaseWindow.getAllWindows().filter(w => w.isVisible()).sort((a, b) => b.getBounds().width - a.getBounds().width)[0];
    win.setAlwaysOnTop(true, 'floating'); win.focus(); await new Promise(r => setTimeout(r, 450));
    const b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor, id = win.getMediaSourceId();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const hit = sources.find(s => s.id === id); win.setAlwaysOnTop(false);
    return hit ? hit.thumbnail.toPNG().toString('base64') : null;
  });
  if (!b64) throw new Error('window capture failed for ' + file);
  await fs.writeFile(path.join(OUT, file), Buffer.from(b64, 'base64')); note('shot', file);
}
const key = (keyCode, modifiers = []) => t.main(({webContents}, a) => { const ui = webContents.getAllWebContents().find(wc => wc.getURL() === 'acira-browser-ui://ui/index.html'); ui.focus(); ui.sendInputEvent({type: 'rawKeyDown', keyCode: a.keyCode, modifiers: a.modifiers}); ui.sendInputEvent({type: 'keyUp', keyCode: a.keyCode, modifiers: a.modifiers}); }, {keyCode, modifiers});
const menuPages = () => t.context.pages().filter(p => { try { return !p.isClosed() && p !== t.ui && /acira-browser-ui:/.test(p.url()); } catch { return false; } });

try {
  slot = await takeSlot(); note('slot', slot);
  mover = cursorMover(); await mover.ready;
  t = await startApp({root: '.qa-profiles/r4-final-shots-' + Date.now(), skipSetup: false});
  const display = await t.main(({screen}) => screen.getAllDisplays().map(d => ({id: d.id, bounds: d.bounds, work: d.workArea, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id})));
  note('displays', JSON.stringify(display));
  const placed = await t.main(({BaseWindow, screen}) => {
    const w = BaseWindow.getAllWindows().filter(x => x.isVisible()).sort((a, b) => b.getBounds().width - a.getBounds().width)[0];
    const d = screen.getPrimaryDisplay().workArea; w.unmaximize(); w.setContentSize(1440, 900); w.setPosition(d.x + Math.max(0, Math.round((d.width - 1440) / 2)), d.y + Math.max(0, Math.round((d.height - 900) / 3)));
    w.show(); w.focus(); return {bounds: w.getBounds(), content: w.getContentBounds(), work: d};
  });
  note('window', JSON.stringify(placed)); await sleep(1200);

  // 01 setup welcome (dark is the setup default)
  await poll(() => t.ui.locator('.setup-dialog').count(), n => n === 1, 'setup visible', 25000);
  await t.ui.evaluate(() => window.acira.dispatch({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100, language: 'en'}}));
  await sleep(3500);
  await shot('01-setup-welcome.png');
  // 02 setup cover step
  const has = sel => t.ui.evaluate(sel => !!document.querySelector(sel), sel);
  const next = async () => { await t.ui.locator('.setup-dialog [data-onboarding-next]').first().click(); await sleep(1300); };
  for (let i = 0; i < 6 && !(await has('.fr-cover')); i++) await next();
  if (!(await has('.fr-cover'))) throw new Error('cover step not reached: ' + await t.ui.evaluate(() => document.querySelector('#fr-title')?.textContent || ''));
  await sleep(1500); note('step title:', await t.ui.evaluate(() => document.querySelector('#fr-title')?.textContent || ''));
  await shot('02-setup-cover-step.png');
  // leave setup (Skip) and wait for the finale to end
  // The per-step Skip never accepts a default-browser or account prompt; the last step ends with Start browsing.
  for (let i = 0; i < 12 && await t.ui.locator('.setup-dialog').count(); i++) {
    const clicked = await poll(() => t.ui.evaluate(() => { for (const name of ['Start browsing', 'Skip', 'Not now', 'Continue', 'Next']) { const b = [...document.querySelectorAll('.setup-dialog button')].find(x => x.textContent.trim() === name && !x.disabled && x.offsetParent); if (b) { b.click(); return name; } } return null; }), Boolean, 'setup button', 9000).catch(() => null);
    if (!clicked) break; note('setup:', clicked); await sleep(900);
    if (clicked === 'Start browsing') break;
  }
  await poll(() => t.ui.locator('.setup-dialog').count(), n => n === 0, 'setup closed', 15000);
  await sleep(600); await finaleEnded(t.ui); await sleep(800);
  try { await t.ui.getByRole('button', {name: 'Done', exact: true}).click({timeout: 2500}); await sleep(900); } catch {}

  // the browser: dark, 100%, tabs in a sidebar
  await t.act({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100, verticalTabs: true, windowView: 'full', language: 'en'}}); await sleep(1000);
  const ids = {};
  for (const name of Object.keys(SITES)) { await t.act({type: 'tab.new', url: base(name) + '/'}); await t.waitWeb(u => u.startsWith(base(name))); ids[name] = (await t.state()).activeTabId; await sleep(500); }
  await t.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}/acira-serp/google/search?q=acira+browser&theme=dark`}); const serpTab = (await t.state()).activeTabId;
  const serpPage = await t.waitWeb(u => u.includes('/acira-serp/google/')); await serpPage.waitForLoadState('domcontentloaded'); await sleep(900);

  // 06 the Preview chip on a fixture search page (hover a result's snippet; the chip appears at the end of the title line)
  const geo = await serpPage.evaluate(() => { const h = [...document.querySelectorAll('main h3,main h2,main .title')][1], snip = h.closest('.MjjYud,.b_algo,article,.snippet,.w-gl__result,.result').querySelector('.VwiC3b,p,.result-snippet,.snippet-description'), s = snip.getBoundingClientRect(); return {x: s.x + 30, y: s.y + s.height / 2}; });
  await serpPage.mouse.move(geo.x + 4, geo.y); await serpPage.mouse.move(geo.x, geo.y); await sleep(700);
  const chip = await serpPage.evaluate(() => !!document.querySelector('acira-preview')); note('preview chip present:', chip);
  if (!chip) throw new Error('Preview chip did not appear');
  await shot('06-search-preview-chip.png');
  await serpPage.mouse.move(40, 40); await sleep(300);

  // 03 tabs in a sidebar + a 2-pane split
  await t.act({type: 'tab.select', id: ids.notes}); await sleep(500);
  await t.act({type: 'split.open', tabIds: [ids.notes, ids.atlas]}); await sleep(1800);
  const split = await t.state(); note('split state:', JSON.stringify(split.split || split.splits || 'n/a').slice(0, 160), 'tabs:', split.tabs.length);
  await shot('03-sidebar-split.png');
  await t.act({type: 'split.close'}); await sleep(900); await t.act({type: 'tab.select', id: ids.journal}); await sleep(900);

  // 04 main menu open (View / Tabs rows)
  await t.ui.locator('button[aria-label="Acira menu"]').first().click(); await sleep(1200);
  const menuText = (await Promise.all(menuPages().map(p => p.evaluate(() => document.body.innerText).catch(() => '')))).join('\n');
  note('menu text has View:', /View/.test(menuText), 'Tabs:', /Tabs/.test(menuText), '|', menuText.replace(/\s+/g, ' ').slice(0, 220));
  await shot('04-main-menu.png');
  await t.ui.keyboard.press('Escape'); await sleep(700);
  if (menuPages().length && await Promise.all(menuPages().map(p => p.evaluate(() => !!document.querySelector('.acira-menu')).catch(() => false))).then(r => r.some(Boolean))) { await t.ui.locator('button[aria-label="Acira menu"]').first().click().catch(() => {}); await sleep(700); }

  // 05 Settings > Appearance, top of the page (Layout group)
  await t.act({type: 'tab.new', url: 'acira://settings'}); await sleep(2200);
  await t.ui.locator('.bs-sidebar nav button[aria-label="Appearance"]').click(); await sleep(900);
  note('first settings group:', await t.ui.evaluate(() => document.querySelector('.st-group h2')?.textContent));
  await shot('05-settings-appearance-layout.png');

  // 08 "Close Acira?" card
  await key('Q', ['control', 'shift']);
  const card = await poll(async () => { for (const p of t.context.pages()) { try { if (p.url().includes('site-prompt.html') && await p.locator('#card').isVisible() && await p.locator('#title').textContent()) return p; } catch {} } }, Boolean, 'close card', 15000);
  await poll(() => card.locator('#title').textContent(), s => /Close Acira\?/.test(s), 'close card title', 6000); await sleep(900);
  note('card:', await card.locator('#title').textContent(), '|', await card.locator('#detail').textContent());
  await shot('08-close-acira-card.png');
  await card.keyboard.press('Escape'); await sleep(900);

  // 07 Seamless: the sidebar floats over Settings when the real cursor reaches the left edge
  await t.act({type: 'settings.update', patch: {windowView: 'seamless'}}); await sleep(10000); // the "Seamless is on" tip toast times out first
  const bounds = () => t.main(({BaseWindow, screen}) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()); const b = w.getContentBounds(); return {...b, sf: screen.getDisplayMatching(b).scaleFactor}; });
  const moveTo = async (x, y) => { const b = await bounds(); const p = await t.main(({screen}, q) => screen.dipToScreenPoint(q), {x: Math.round(b.x + x), y: Math.round(b.y + y)}); await mover.move(p.x, p.y); };
  const sideShown = () => t.ui.evaluate(() => !!document.querySelector('.acira-sidebar.is-expanded'));
  const b0 = await bounds(); const sideY = b0.height * 0.45;
  await t.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows().find(x => x.isVisible()); w.show(); w.focus(); w.setAlwaysOnTop(true, 'floating'); });
  await moveTo(b0.width * 0.55, b0.height * 0.5); await sleep(900);
  for (let i = 1; i <= 6; i++) { await moveTo(160 - (157 * i) / 6, sideY); await sleep(20); }
  for (let i = 0; i < 10 && !(await sideShown()); i++) { await moveTo(3, sideY); await sleep(120); }
  await sleep(900); note('sidebar floating over Settings:', await sideShown());
  if (!await sideShown()) throw new Error('the sidebar did not float');
  await shot('07-seamless-sidebar-over-settings.png');
  await moveTo(b0.width * 0.6, b0.height * 0.55); await sleep(400);
  await t.act({type: 'settings.update', patch: {windowView: 'full'}});
  note('DONE');
} catch (e) {
  note('FAIL', String(e?.stack || e).slice(0, 900)); process.exitCode = 1;
  try { await shot('failure.png'); } catch {}
} finally {
  clearTimeout(watchdog);
  await fs.writeFile(path.join(OUT, 'report.txt'), report.join('\n')).catch(() => {});
  try { mover?.close(); } catch {}
  if (t) { const child = (() => { try { return t.app.process(); } catch { return null; } })(); try { await Promise.race([t.close(), sleep(12000)]); } catch {} try { if (child && child.exitCode === null) child.kill(); } catch {} }
  await fx.close().catch(() => {}); if (slot) await fs.unlink(slot).catch(() => {});
}
