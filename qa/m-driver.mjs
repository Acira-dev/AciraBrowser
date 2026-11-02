// Stream M UI QA driver (fork of qa/l-driver.mjs): real app on a disposable profile with a 127.0.0.1 control endpoint.
//   node qa/m-driver.mjs [port] [outDir] [profileDir]
//   env M_SCALE=1.5 (stands in for Windows 150%), M_NOSKIP=1 (stay on setup), M_SEED=<dir> (copy a prepared profile)
//   POST /eval /oeval /main  as in l-driver · GET /shot?name=x[&scale=1] real composited window pixels
//   GET /burst?name=x&n=8&gap=0 window captures back to back · GET /obursts?name=x&n=8 overlay capturePage burst
//   POST /keys /okeys ["Ctrl+t"] · POST /click {x,y,button} · POST /move {x,y} (hover) · POST /bounds {x,y,width,height}
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { _electron } from 'playwright';
import { launchPreparedNative } from './prepared-native.mjs';

const port = Number(process.argv[2] || 47931), out = path.resolve(process.argv[3] || '.qa-profiles/m-shots');
const data = path.resolve(process.argv[4] || '.qa-profiles/m-qa-' + Date.now());
await fs.mkdir(out, { recursive: true });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture') };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const args = [...(process.env.M_SCALE ? ['--force-device-scale-factor=' + process.env.M_SCALE] : []), path.resolve('desktop/main.cjs')];
const executablePath = createRequire(import.meta.url)('electron');
let app;
if (process.env.M_SEED) { await fs.cp(path.resolve(process.env.M_SEED), data, { recursive: true, filter: s => !/lockfile$|Singleton/.test(s) }); app = await _electron.launch({ executablePath, args, env, timeout: 30000 }); }
else app = await launchPreparedNative({ executablePath, args, env, timeout: 30000 });
// Watchdog: the instance closes itself after M_TTL_MIN minutes (default 45) even if nobody sends /quit.
const ttl = setTimeout(() => app.close().catch(() => {}).finally(() => process.exit(0)), Number(process.env.M_TTL_MIN || 45) * 60000);
process.on('SIGINT', () => app.close().catch(() => {}).finally(() => process.exit(0)));
process.on('exit', () => clearTimeout(ttl));
const find = async (test, label) => {
  for (let i = 0; i < 200; i++) {
    const page = app.windows().find(p => test(p.url()));
    if (page) return page;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error(label + ' page not found');
};
const ui = () => find(url => url === 'acira-browser-ui://ui/index.html', 'UI');
const overlay = () => find(url => url.startsWith('acira-browser-ui://ui/index.html?view=overlay'), 'Overlay');
let page = await ui();
const consoleLog = [], watched = new WeakSet();
const watch = p => { if (watched.has(p)) return; watched.add(p); p.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleLog.push(`${p.url().split('?')[1] || 'ui'} ${m.type()}: ${m.text().slice(0, 300)}`); }); p.on('pageerror', e => consoleLog.push(`${p.url().split('?')[1] || 'ui'} pageerror: ${String(e).slice(0, 300)}`)); };
watch(page); app.on('window', p => { if (p.url().startsWith('acira-browser-ui://')) watch(p); }); for (const p of app.windows()) if (p.url().startsWith('acira-browser-ui://')) watch(p);
if (!process.env.M_NOSKIP) try { await page.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
const wait = ms => new Promise(r => setTimeout(r, ms));
const out_dir_shot = out;
const body = req => new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => r(s)); });
const capture = (scale) => app.evaluate(async ({ BaseWindow, desktopCapturer, screen }, scale) => {
  const win = BaseWindow.getAllWindows().filter(w => w.isVisible()).sort((x, y) => y.getBounds().width - x.getBounds().width)[0], b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor;
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.round(b.width * f * scale), height: Math.round(b.height * f * scale) } });
  const source = sources.find(s => s.id === win.getMediaSourceId());
  return source ? source.thumbnail.toPNG().toString('base64') : null;
}, scale);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    let result;
    if (url.pathname === '/eval') { page = await ui(); result = await page.evaluate(new Function('return (async()=>(' + await body(req) + '))()')); }
    else if (url.pathname === '/oeval') { const o = await overlay(); result = await o.evaluate(new Function('return (async()=>(' + await body(req) + '))()')); }
    else if (url.pathname === '/main') result = await app.evaluate(eval(await body(req)));
    else if (url.pathname === '/shot') {
      const png = await capture(Number(url.searchParams.get('scale') || 1));
      const file = path.join(out, (url.searchParams.get('name') || 'shot') + '.png');
      if (png) await fs.writeFile(file, Buffer.from(png, 'base64'));
      result = png ? file : 'no source';
    } else if (url.pathname === '/burst') {
      const n = Number(url.searchParams.get('n') || 8), gap = Number(url.searchParams.get('gap') || 0), scale = Number(url.searchParams.get('scale') || .5), name = url.searchParams.get('name') || 'burst';
      const frames = [], t0 = Date.now();
      for (let i = 0; i < n; i++) { frames.push([Date.now() - t0, await capture(scale)]); if (gap) await new Promise(r => setTimeout(r, gap)); }
      result = [];
      for (const [i, [t, png]] of frames.entries()) { const file = path.join(out, `${name}-${i}-${t}ms.png`); if (png) await fs.writeFile(file, Buffer.from(png, 'base64')); result.push(file); }
    } else if (url.pathname === '/keys') { page = await ui(); for (const k of JSON.parse(await body(req))) await page.keyboard.press(k); result = 'ok'; }
    else if (url.pathname === '/okeys') { const o = await overlay(); for (const k of JSON.parse(await body(req))) await o.keyboard.press(k); result = 'ok'; }
    else if (url.pathname === '/type') { page = await ui(); await page.keyboard.type(await body(req)); result = 'ok'; }
    else if (url.pathname === '/click') { page = await ui(); const { x, y, button } = JSON.parse(await body(req)); await page.mouse.click(x, y, { button: button || 'left' }); result = 'ok'; }
    // R3 bughunt: the same three actions on the OVERLAY page (popups, menus, toasts), so rows get real pointer events.
    else if (url.pathname === '/oclick') { const o = await overlay(), { x, y, button } = JSON.parse(await body(req)); await o.mouse.click(x, y, { button: button || 'left' }); result = 'ok'; }
    else if (url.pathname === '/omove') { const o = await overlay(), { x, y } = JSON.parse(await body(req)); await o.mouse.move(x, y); result = 'ok'; }
    else if (url.pathname === '/otype') { const o = await overlay(); await o.keyboard.type(await body(req)); result = 'ok'; }
    else if (url.pathname === '/move') { page = await ui(); const { x, y } = JSON.parse(await body(req)); await page.mouse.move(x, y); result = 'ok'; }
    else if (url.pathname === '/bounds') { const b = JSON.parse(await body(req)); result = await app.evaluate(({ BaseWindow }, b) => { const w = BaseWindow.getAllWindows().filter(w => w.isVisible()).sort((x, y) => y.getBounds().width - x.getBounds().width)[0]; w.setBounds(b); return w.getBounds(); }, b); }
    else if (url.pathname === '/edgescan') {
      // POST /edgescan?page=ui|overlay&hover=1&cap=120 : qa/m-edge-scan.js at rest, then real mouse hover over each candidate (hard cap 200).
      const pg = url.searchParams.get('page') === 'overlay' ? await overlay() : await ui(), hover = url.searchParams.get('hover') === '1', cap = Math.min(Number(url.searchParams.get('cap') || 120), 200);
      await pg.evaluate(await fs.readFile(path.resolve('qa/m-edge-scan.js'), 'utf8'));
      const rest = await pg.evaluate(() => window.__edge.static()), hov = [];
      let n = 0;
      if (hover) {
        n = await pg.evaluate(() => { window.__cand = window.__edge.candidates(); return window.__cand.length; });
        for (let i = 0; i < Math.min(n, cap); i++) {
          const pos = await pg.evaluate(i => { const e = window.__cand[i]; if (!e || !e.isConnected) return null; return window.__edge.rect(e); }, i);
          if (!pos) continue;
          await pg.mouse.move(pos[0], pos[1]); await new Promise(r => setTimeout(r, 70));
          hov.push(...await pg.evaluate(i => window.__edge.el(window.__cand[i]), i));
          if (url.searchParams.get('press') === '1') { await pg.mouse.down(); await wait(60); hov.push(...(await pg.evaluate(i => window.__edge.el(window.__cand[i]), i)).map(f => ({ ...f, state: 'pressed' }))); await pg.mouse.move(2, 2); await pg.mouse.up(); }
        }
        await pg.mouse.move(2, 2);
      }
      const seen = new Set(), uniq = a => a.filter(f => { const k = f.box + f.what + f.problem; if (seen.has(k)) return false; seen.add(k); return true; });
      result = { candidates: n, rest: uniq(rest), hover: uniq(hov) };
    }
    else if (url.pathname === '/focusscan') {
      // POST /focusscan?page=ui|overlay&n=40 : Tab through the page (hard cap 80), after each stop run __edge.focus().
      const pg = url.searchParams.get('page') === 'overlay' ? await overlay() : await ui(), n = Math.min(Number(url.searchParams.get('n') || 40), 80);
      await pg.evaluate(await fs.readFile(path.resolve('qa/m-edge-scan.js'), 'utf8'));
      const stops = [], finds = [], seen = new Set();
      for (let i = 0; i < n; i++) { await pg.keyboard.press('Tab'); await wait(60); const r = await pg.evaluate(() => window.__edge.focus()); if (!r) continue; stops.push(r.label); for (const f of r.findings) { const k = f.box + f.problem + f.what; if (!seen.has(k)) { seen.add(k); finds.push(f); } } }
      result = { stops: stops.length, labels: stops, findings: finds };
    }
    else if (url.pathname === '/mouse') {
      // POST /mouse body=[{t:'move',x,y,steps?},{t:'down'},{t:'up'},{t:'wait',ms},{t:'shot',name}] on the chrome UI page (hard cap 60 steps)
      page = await ui(); const out = [];
      for (const a of JSON.parse(await body(req)).slice(0, 60)) {
        if (a.t === 'move') await page.mouse.move(a.x, a.y, { steps: a.steps || 1 }); else if (a.t === 'down') await page.mouse.down(); else if (a.t === 'up') await page.mouse.up(); else if (a.t === 'wait') await new Promise(r => setTimeout(r, Math.min(a.ms || 100, 3000)));
        else if (a.t === 'shot') { const png = await capture(1); if (png) { const f = path.join(out_dir_shot, a.name + '.png'); await fs.writeFile(f, Buffer.from(png, 'base64')); out.push(f); } }
      }
      result = out;
    }
    else if (url.pathname === '/console') { for (const p of app.windows()) if (p.url().startsWith('acira-browser-ui://')) watch(p); result = consoleLog.splice(0); }
    else if (url.pathname === '/reload') { page = await ui(); await page.reload(); result = 'ok'; }
    else if (url.pathname === '/quit') { res.end('bye'); await app.close(); process.exit(0); }
    res.end(JSON.stringify(result ?? null));
  } catch (error) { res.statusCode = 500; res.end(String(error?.stack || error)); }
}).listen(port, '127.0.0.1', () => console.log('m driver ready on ' + port + ' profile ' + data));
