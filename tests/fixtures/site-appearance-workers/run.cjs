'use strict';
// Real Electron: Website appearance ("Always dark", or Light / Dark that differ from Acira's own appearance: every one of them holds a debugger session) on a page that keeps
// starting and ending Web Workers, and on a page with a cross-site frame (13.4).
// In 13.3 the module attached the page's debugger to every worker (Target.setAutoAttach) and detached each one again (Target.detachFromTarget); that made Electron's MAIN
// process die with a SIGSEGV within seconds. This runs the real desktop/site-appearance.cjs against real Chromium: the process must stay alive, the page must be told
// dark, the cross-site frame too, and no renderer may crash. Prints one line: RESULT <json>. Run by tests/site-appearance-workers.test.cjs
// (also: electron tests/fixtures/site-appearance-workers/run.cjs). WORKER_SECONDS = how long the workers churn (default 10), WORKER_MODE = always-dark (default) | dark | light,
// WORKER_ACIRA = Acira's own appearance light (default) | dark.
const {app, BrowserWindow, nativeTheme} = require('electron'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
app.commandLine.appendSwitch('use-mock-keychain'); app.commandLine.appendSwitch('mute-audio'); // never the real Keychain, never a sound
nativeTheme.themeSource = process.env.WORKER_ACIRA === 'dark' ? 'dark' : 'light'; // pages follow Acira's own appearance unless the module tells them otherwise
const websiteMode = ['always-dark', 'dark', 'light'].includes(process.env.WORKER_MODE) ? process.env.WORKER_MODE : 'always-dark';
const root = path.resolve(__dirname, '..', '..', '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-appearance-workers-')); app.setPath('userData', data); app.setName('Acira appearance workers qualification');
const {createSiteAppearance} = require(path.join(root, 'desktop', 'site-appearance.cjs'));
const seconds = Number(process.env.WORKER_SECONDS || 10), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = {gone: [], steps: [], mode: websiteMode, acira: nativeTheme.themeSource};
const done = (code, error) => { console.log('RESULT ' + JSON.stringify({...out, ...(error ? {error: String(error)} : {})})); try { fs.rmSync(data, {recursive: true, force: true}); } catch { /* left for the OS */ } app.exit(code); };
setTimeout(() => done(3, 'timed out'), 90000).unref();

const PAGE = port => `<!doctype html><meta charset=utf-8><title>workers</title><body>
<iframe id=frame src="http://localhost:${port}/frame" width=300 height=100></iframe>
<script>
let n = 0;
function spawn() { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1);setTimeout(()=>close(),' + (n % 3 ? 5 : 40) + ')']))); n++; w.onmessage = () => { if (n % 2) w.terminate(); }; }
setInterval(() => { for (let i = 0; i < 3; i++) spawn(); }, 30);
</script>`;
const FRAME = '<!doctype html><meta charset=utf-8><title>frame</title><p>a frame from another site</p>';

app.whenReady().then(async () => {
  const server = http.createServer((request, response) => { response.setHeader('content-type', 'text/html'); response.end(request.url.startsWith('/frame') ? FRAME : PAGE(server.address().port)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, url = `http://127.0.0.1:${port}/`;
  try {
    const window = new BrowserWindow({show: false, width: 800, height: 600, webPreferences: {partition: 'site-appearance-workers'}}), wc = window.webContents; // an in-memory session: nothing is written
    wc.on('render-process-gone', (_event, details) => out.gone.push(details.reason));
    const appearance = createSiteAppearance({database: {policy: () => null, policies: () => [], setPolicy() {}, deletePolicy() {}}, mode: () => websiteMode, nativeDark: () => nativeTheme.shouldUseDarkColors, profileOf: entry => entry.profileId});
    appearance.attach(wc, {id: 't1', browserProfileId: 'p1'}); // before the first load, as the browser does
    await wc.loadURL(url);
    for (let i = 0; i < 100 && !appearance.stateOf(wc)?.session; i++) await sleep(100);
    out.steps.push({step: 'session', value: appearance.stateOf(wc)});
    const started = Date.now();
    while (Date.now() - started < seconds * 1000) { await sleep(1000); if (Date.now() - started < seconds * 800) wc.reload(); } // workers keep coming, and the page is reloaded now and then
    for (let i = 0; i < 100 && !appearance.stateOf(wc)?.session; i++) await sleep(100);
    await appearance.whenIdle(wc); await sleep(500);
    const darkOf = frame => frame.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches");
    const frames = wc.mainFrame.framesInSubtree.filter(frame => frame !== wc.mainFrame);
    out.page = await darkOf(wc.mainFrame);
    out.frames = []; for (const frame of frames) out.frames.push({url: frame.url, dark: await darkOf(frame).catch(error => 'error: ' + error.message)});
    out.state = appearance.stateOf(wc); out.alive = !wc.isDestroyed() && !wc.isCrashed();
    done(0);
  } catch (error) { done(2, error && error.stack || error); }
});
