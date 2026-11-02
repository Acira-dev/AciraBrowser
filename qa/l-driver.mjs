// Stream L QA driver: launches the real app on a disposable profile and exposes a local control endpoint
// (127.0.0.1 only) for step-by-step bug-bash checks without relaunching.
//   node qa/l-driver.mjs [port] [outDir] [profileDir]
//   POST /eval   body = JS expression evaluated in the chrome UI page (JSON result)
//   POST /oeval  body = JS expression evaluated in the popup overlay page
//   POST /main   body = JS function source `({app,BaseWindow,desktopCapturer})=>…` run in the main process
//   GET  /shot?name=x[&scale=.5]  real composited pixels of the whole window (menus, overlays, web views)
//   GET  /burst?name=x&n=8&gap=16  n window captures back to back (motion check)
//   POST /keys   body = ["Alt+t", ...] real key presses into the chrome UI page
//   POST /click  body = {x,y} real mouse click in the chrome UI page
//   GET  /reload | /quit
// L_EXTRA_ARGS="--use-fake-device-for-media-stream" adds Chromium switches (fake camera/mic: no real hardware).
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const port = Number(process.argv[2] || 47821), out = path.resolve(process.argv[3] || '.qa-profiles/l-shots');
const data = path.resolve(process.argv[4] || '.qa-profiles/l-bash-' + Date.now());
await fs.mkdir(out, { recursive: true });
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.resolve('desktop/main.cjs'), ...(process.env.L_EXTRA_ARGS || '').split(' ').filter(Boolean)],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture') },
  timeout: 30000,
});
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
// GET /console → errors and warnings from every Acira UI page since the last read.
const consoleLog = [], watched = new WeakSet();
const watch = p => { if (watched.has(p)) return; watched.add(p); p.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleLog.push(`${p.url().split('?')[1] || 'ui'} ${m.type()}: ${m.text().slice(0, 300)}`); }); p.on('pageerror', e => consoleLog.push(`${p.url().split('?')[1] || 'ui'} pageerror: ${String(e).slice(0, 300)}`)); p.on('response', r => { if (r.status() >= 400) consoleLog.push(`${p.url().split('?')[1] || 'ui'} http ${r.status()}: ${r.url().slice(0, 200)}`); }); };
watch(page); app.on('window', p => { if (p.url().startsWith('acira-browser-ui://')) watch(p); }); for (const p of app.windows()) if (p.url().startsWith('acira-browser-ui://')) watch(p);
try { await page.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 8000 }); } catch {}
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
    else if (url.pathname === '/click') { page = await ui(); const { x, y, button } = JSON.parse(await body(req)); await page.mouse.click(x, y, { button: button || 'left' }); result = 'ok'; }
    else if (url.pathname === '/console') { for (const p of app.windows()) if (p.url().startsWith('acira-browser-ui://')) watch(p); result = consoleLog.splice(0); }
    else if (url.pathname === '/reload') { page = await ui(); await page.reload(); result = 'ok'; }
    else if (url.pathname === '/quit') { res.end('bye'); await app.close(); process.exit(0); }
    res.end(JSON.stringify(result ?? null));
  } catch (error) { res.statusCode = 500; res.end(String(error?.stack || error)); }
}).listen(port, '127.0.0.1', () => console.log('l driver ready on ' + port + ' profile ' + data));
