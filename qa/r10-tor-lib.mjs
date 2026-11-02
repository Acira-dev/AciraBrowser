// Shared helpers for the Tor control rigs (qa/r10-tor-ux.mjs, qa/r10-tor-scan.mjs): an offscreen, non-focused window, composited
// pixels of the app's own window, the clip scanner on a page, the overlay (panel) page, a Tor tab, a renderer's command line.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import net from 'node:net';
import {sleep, poll} from './d-harness.mjs';

export const IP_URL = 'https://check.torproject.org/api/ip';
export const SHOTS = path.resolve('qa/artifacts/r10-tor');

/** The window is shown but far off screen and never takes focus (the founder's screen and mouse stay untouched). */
export async function showOffscreen(app, {width = 1440, height = 900} = {}) {
  await app.act({type: 'settings.update', patch: {windowView: 'full'}}); // the fixed QA profile may have been left in Seamless by an earlier run
  await app.main(({BaseWindow}, size) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: -3000, y: 20, ...size}); if(process.platform==='darwin'){for(const child of w.contentView.children)child.webContents?.setBackgroundThrottling(false);}else w.showInactive(); }, {width, height});
  await sleep(500);
}
/** Real composited pixels of the app's own window (desktopCapturer on its own media source), written to qa/artifacts/r10-tor/<name>.png. */
export async function capture(app, name) {
  await fs.mkdir(SHOTS, {recursive: true});
  const png = await app.main(async ({BaseWindow, desktopCapturer}) => {
    const w = BaseWindow.getAllWindows()[0], b = w.getBounds();
    if(process.platform==='darwin'){const view=w.contentView.children.find(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html');return view?(await view.webContents.capturePage()).toPNG().toString('base64'):'';}
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: b.width, height: b.height}});
    const source = sources.find(item => item.id === w.getMediaSourceId());
    return source ? source.thumbnail.toPNG().toString('base64') : '';
  });
  if (png) await fs.writeFile(path.join(SHOTS, name + '.png'), Buffer.from(png, 'base64'));
  console.log(png ? `shot ${name}` : `shot FAILED ${name}`);
  return Boolean(png);
}
/** Real key press into a webContents (native input, like the keyboard; main's before-input-event sees it). */
export const press = (app, urlPrefix, key, modifiers) => app.main(({webContents}, {urlPrefix, key, modifiers}) => {
  const wc = webContents.getAllWebContents().find(w => !w.isDestroyed() && w.getURL().startsWith(urlPrefix)); if (!wc) return false;
  wc.sendInputEvent({type: 'keyDown', keyCode: key, modifiers}); wc.sendInputEvent({type: 'keyUp', keyCode: key, modifiers}); return true;
}, {urlPrefix, key, modifiers});
export async function overlayPage(app, timeout = 10000) {
  return poll(() => app.context.pages().find(p => { try { return p.url().startsWith('acira-browser-ui://ui/index.html?view=overlay'); } catch { return false; } }), Boolean, 'overlay page', timeout);
}
export async function openTorTab(app, url) {
  const before = new Set((await app.state()).tabs.map(t => t.id));
  await app.act({type: 'tab.new', privacy: 'tor', url});
  return poll(async () => (await app.state()).tabs.find(t => !before.has(t.id)), Boolean, 'new Tor tab', 10000);
}
/** Waits until Tor says it is connected (first run downloads the consensus: up to a few minutes). */
export const torReady = app => poll(() => app.ui.evaluate(() => window.acira.native({type: 'tor.status'})), reply => reply?.tor?.state === 'ready', 'Tor ready', 300000);
/** The clip/overlap scanner (qa/m-clip-scan.js) on a page: 'no hits' or one " :: " line per hit. */
let scannerSource = '';
export async function scan(page) {
  scannerSource ||= await fs.readFile(path.resolve('qa/m-clip-scan.js'), 'utf8');
  return String(await page.evaluate(scannerSource));
}
export const scanHits = text => String(text).split('\n').filter(line => / :: /.test(line));
/** The command line of the OS process a page runs in (to see the flags its renderer really got). */
export function commandLine(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  try { if(process.platform==='darwin')return execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8',timeout:5000}); return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], {encoding: 'utf8', windowsHide: true, timeout: 20000}); } catch { return ''; }
}
/** Page-level facts at a security level: WebAssembly, MathML, WebGL, an injected inline script, and how fast a hot loop runs (JIT on or off). */
export const probeLevel = page => page.evaluate(() => {
  const out = {wasm: typeof WebAssembly, mathml: typeof MathMLElement};
  try { const canvas = document.createElement('canvas'); out.webgl = Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl')); } catch { out.webgl = false; }
  const script = document.createElement('script'); script.textContent = 'window.__acira_ran = 1'; document.documentElement.append(script); out.inlineScript = window.__acira_ran === 1;
  const fib = n => n < 2 ? n : fib(n - 1) + fib(n - 2); fib(18); const start = performance.now(); out.x = fib(30); out.loopMs = Math.round(performance.now() - start);
  return out;
});

/** The colour [r, g, b] of one pixel of a capture written by capture(): the margin around a letterboxed page against the toolbar, for instance. */
export async function pixel(name, x, y) {
  const {PNG} = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
  const png = PNG.sync.read(await fs.readFile(path.join(SHOTS, name + '.png'))), i = (png.width * y + x) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}
export const sameColour = (a, b, tolerance = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

/** Raw replies of Acira's own tor to control commands (cookie authentication, a second connection): to look at what tor holds, e.g. ONION_CLIENT_AUTH_VIEW. */
export async function torControl(profileRoot, commands) {
  const run = path.join(profileRoot, 'tor', 'run'), port = Number(/:(\d+)/.exec(await fs.readFile(path.join(run, 'controlport'), 'utf8'))[1]);
  const cookie = (await fs.readFile(path.join(run, 'control_auth_cookie'))).toString('hex');
  return new Promise((resolve, reject) => {
    const socket = net.connect({host: '127.0.0.1', port}); let out = ''; socket.setEncoding('latin1');
    socket.on('data', chunk => { out += chunk; }); socket.on('error', reject); socket.on('close', () => resolve(out));
    socket.on('connect', () => { socket.write('AUTHENTICATE ' + cookie + '\r\n'); for (const command of commands) socket.write(command + '\r\n'); socket.write('QUIT\r\n'); });
  });
}
/** Files under a folder (each up to 6 MB) that contain any of the strings, as UTF-8 or UTF-16. Used to show a secret never reached the disk. */
export async function findInFiles(folder, needles) {
  const found = [], bytes = needles.flatMap(needle => [Buffer.from(needle, 'utf8'), Buffer.from(needle, 'utf16le')]);
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, {withFileTypes: true}).catch(() => [])) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) { try { const stat = await fs.stat(file); if (stat.size > 6 * 1024 * 1024) continue; const data = await fs.readFile(file); if (bytes.some(needle => data.includes(needle))) found.push(path.relative(folder, file)); } catch {} }
    }
  }
  await walk(folder);
  return found;
}
