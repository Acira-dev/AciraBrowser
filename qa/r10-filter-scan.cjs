'use strict';
// R10 lag-fix rig: what does the content-filter script cost a page's main thread?
// Loads a URL in a hidden window, injects the REAL desktop/browser-services/content-filter-preload.cjs (stubbed ipcRenderer, real annoyance
// style sheet and AI rules for that host), then drives mutations like an animating site and reads a V8 CPU profile.
// Usage: node qa/native-slot.mjs r10-filter -- <electron> qa/r10-filter-scan.cjs <url> [scriptPath]
// The profile attributes time to the injected script through its sourceURL, so it works on any version of the script.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { app, BrowserWindow } = require('electron');
const root = path.join(__dirname, '..');
const { createAnnoyanceRules } = require(path.join(root, 'desktop/browser-services/annoyance-rules.cjs'));
const { surfacesFor } = require(path.join(root, 'desktop/browser-services/ai-surfaces.cjs'));
app.setPath('userData', path.join(os.tmpdir(), 'acira-r10-filter-' + process.pid));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const url = process.argv[2] || 'https://en.wikipedia.org/wiki/United_States';
const scriptPath = path.resolve(process.argv[3] || path.join(root, 'desktop/browser-services/content-filter-preload.cjs'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const runtime = fs.readFileSync(scriptPath, 'utf8').replace("const {ipcRenderer}=require('electron');", '').replace('if(process.isMainFrame&&', 'if(');
const host = new URL(url).hostname;
const surface = surfacesFor(host);
const options = {
  enabled: true, selectors: [], sources: [], aiRules: surface ? surface.items : [], preStyles: '',
  annoyanceSelectors: [], annoyanceStyles: createAnnoyanceRules().styles(url), cookieHints: true, version: 'rig',
};
const inject = `(()=>{const ipcRenderer={invoke:async(channel)=>channel==='acira:content-filter-options'?(${JSON.stringify(options)}):channel.endsWith('is-mutation-observer-enabled')?true:'',send:()=>{},sendSync:()=>null,on:()=>{}};${runtime}\n})()\n//# sourceURL=acira-cf.js`;
// A page that animates: classes flip on a rolling set of elements (carousels, hover states), then style-only changes (transforms, opacity).
const DRIVE = (ms, mode) => `new Promise(resolve=>{const all=[...document.body.querySelectorAll('*')].filter((_,index)=>index%7===0).slice(0,400);let tick=0;const end=performance.now()+${ms};
  const id=setInterval(()=>{tick++;for(let i=0;i<30;i++){const node=all[(tick*31+i*13)%all.length];if(!node)continue;if(${JSON.stringify(mode)}==='class')node.classList.toggle('r10-anim');else node.style.opacity=(tick%2)?'0.99':'1';}
  if(performance.now()>end){clearInterval(id);resolve(tick);}},50);})`;
async function profile(wc, label, body) {
  const dbg = wc.debugger; await dbg.sendCommand('Profiler.enable'); await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 100 });
  await dbg.sendCommand('Profiler.start'); await body(); const { profile: p } = await dbg.sendCommand('Profiler.stop');
  const byId = new Map(p.nodes.map(node => [node.id, node])), self = new Map();
  for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) || 0) + (p.timeDeltas[i] || 0));
  let total = 0; const byFn = {};
  for (const [id, micro] of self) { const node = byId.get(id); if (!node || node.callFrame.url !== 'acira-cf.js') continue; total += micro; const key = node.callFrame.functionName || '(anon)'; byFn[key] = (byFn[key] || 0) + micro; }
  const parentOf = new Map(); for (const node of p.nodes) for (const child of node.children || []) parentOf.set(child, node);
  const allFn = {}; for (const [id, micro] of self) { const node = byId.get(id); if (!node) continue; const parent = parentOf.get(id); const key = (node.callFrame.functionName || '(anon)') + (node.callFrame.url === 'acira-cf.js' ? '*' : '') + (node.callFrame.functionName === 'querySelectorAll' && parent ? '<' + (parent.callFrame.functionName || '(anon)') + (parent.callFrame.url === 'acira-cf.js' ? '*' : '') + ':' + parent.callFrame.lineNumber : ''); allFn[key] = (allFn[key] || 0) + micro; }
  const everything = Object.entries(allFn).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, micro]) => `${name}=${(micro / 1000).toFixed(0)}`).join(' ');
  const top = Object.entries(byFn).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, micro]) => `${name}=${(micro / 1000).toFixed(1)}`).join(' ');
  return { label, filterMs: +(total / 1000).toFixed(1), top, everything };
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.debugger.attach('1.3');
  await win.loadURL(url); await sleep(2500);
  const wc = win.webContents;
  const nodes = await wc.executeJavaScript('document.getElementsByTagName("*").length');
  await wc.executeJavaScript(`window.__long=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.__long.push(Math.round(e.duration));}).observe({entryTypes:['longtask']});0`);
  const out = [];
  out.push(await profile(wc, 'inject+first scans (3s)', async () => { if (!process.env.NOFILTER) await wc.executeJavaScript(inject); await sleep(3000); }));
  out.push(await profile(wc, 'idle (3s)', async () => { await sleep(3000); }));
  out.push(await profile(wc, 'class animation (4s)', async () => { await wc.executeJavaScript(DRIVE(4000, 'class')); await sleep(400); }));
  out.push(await profile(wc, 'style-only animation (4s)', async () => { await wc.executeJavaScript(DRIVE(4000, 'style')); await sleep(400); }));
  const long = await wc.executeJavaScript('window.__long');
  process.stdout.write('RESULT ' + JSON.stringify({ url, script: path.basename(scriptPath), nodes, styleRules: (options.annoyanceStyles.match(/display\s*:\s*none/g) || []).length, out, longTasks: long }) + '\n');
  win.destroy(); app.exit(0);
});
