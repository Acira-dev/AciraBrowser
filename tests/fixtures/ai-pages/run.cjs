'use strict';
// Electron runner for tests/privacy-plus-ai-fixtures.test.cjs: loads saved results pages over http in a hidden window, injects the app's real frame script
// with the rules the app would pass for that host, and prints what stayed visible. Usage: electron run.cjs '<cases json>'
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow } = require('electron');
const { surfacesFor } = require('../../../desktop/browser-services/ai-surfaces.cjs');
app.setPath('userData', path.join(os.tmpdir(), 'acira-ai-fixtures-' + process.pid));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const cases = JSON.parse(process.argv[process.argv.length - 1]);
const runtime = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'content-filter-preload.cjs'), 'utf8').replace("const {ipcRenderer}=require('electron');", '').replace('if(process.isMainFrame&&', 'if(').replace('function restore(){', "globalThis[Symbol.for('acira.frame-filter-teardown')]=()=>{dead=true;observer?.disconnect();clearTimeout(timer);restore();};function restore(){");
const inject = options => `(()=>{const old=globalThis[Symbol.for('acira.frame-filter-teardown')];if(typeof old==='function')old();const ipcRenderer={invoke:async()=>(${JSON.stringify(options)}),send:()=>{},on:()=>{}};${runtime}\n})()`;
const MEASURE = spec => `(() => { const seen = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const all = sel => [...document.querySelectorAll(sel)];
  return { organic: all(${JSON.stringify(spec.organic)}).filter(seen).length, organicTotal: all(${JSON.stringify(spec.organic)}).length,
    block: all(${JSON.stringify(spec.block)}).filter(seen).length, blockTotal: all(${JSON.stringify(spec.block)}).length,
    entries: all(${JSON.stringify(spec.entries.join(','))}).filter(seen).length, entriesTotal: all(${JSON.stringify(spec.entries.join(','))}).length,
    lines: all('[data-acira-filter-control]').map(n => n.innerText.trim()),
    stay: all(${JSON.stringify((spec.stay || ['body']).join(','))}).filter(seen).length, stayTotal: all(${JSON.stringify((spec.stay || ['body']).join(','))}).length,
    bodyVisible: seen(document.body), title: document.title }; })()`;
const server = http.createServer((req, res) => { try { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(__dirname, path.basename(decodeURIComponent(req.url.split('?')[0]))))); } catch { res.statusCode = 404; res.end(); } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port, out = [];
  for (const spec of cases) {
    const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL(`http://127.0.0.1:${port}/${spec.file}`); await sleep(250);
    const wc = win.webContents, before = await wc.executeJavaScript(MEASURE(spec));
    const surfaces = surfacesFor(spec.host);
    await wc.executeJavaScript(inject({ enabled: true, selectors: [], sources: [], annoyanceSelectors: [], aiRules: spec.rules || (surfaces ? surfaces.items : []) }));
    if (spec.late) { await sleep(120); await wc.executeJavaScript('window.__fill()'); }
    await sleep(700);
    const after = await wc.executeJavaScript(MEASURE(spec));
    let revealed = null; if (after.lines.length) { await wc.executeJavaScript("document.querySelector('[data-acira-filter-control] button').click()"); await sleep(150); revealed = await wc.executeJavaScript(MEASURE(spec)); }
    await wc.executeJavaScript(inject({ enabled: true, selectors: [], sources: [], annoyanceSelectors: [], aiRules: [] })); await sleep(300);
    const restored = await wc.executeJavaScript(MEASURE(spec));
    out.push({ id: spec.id || spec.file, file: spec.file, host: spec.host, rules: !!surfaces, before, after, revealed, restored });
    win.destroy();
  }
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n'); server.close(); app.exit(0);
});
