// "Chrome-like" control for the memory comparison: the same Electron/Chromium, 7 bare views on the same 7 sites, no Acira anywhere.
//   ELECTRON_RUN... node_modules/.bin/electron qa/memory-rig/bare-electron.cjs <settleSeconds>   (the shared mock-keychain hook via NODE_OPTIONS; userData in /tmp/acira-qa/memory-rig/bare)
const {app, BrowserWindow, WebContentsView} = require('electron');
const cp = require('node:child_process');
app.setPath('userData', '/tmp/acira-qa/memory-rig/bare');
const SITES = ['https://en.wikipedia.org/wiki/Web_browser', 'https://news.ycombinator.com/', 'https://developer.mozilla.org/en-US/', 'https://www.bbc.com/news', 'https://docs.python.org/3/', 'https://www.theguardian.com/international', 'https://www.w3.org/'];
const settle = Number(process.env.SETTLE || 60) * 1000;
app.whenReady().then(async () => {
  const win = new BrowserWindow({width: 1100, height: 700, show: false});
  const views = SITES.map(url => { const v = new WebContentsView({webPreferences: {sandbox: true}}); win.contentView.addChildView(v); v.setBounds({x: 0, y: 0, width: 1100, height: 700}); v.webContents.setAudioMuted(true); v.webContents.loadURL(url).catch(() => {}); return v; });
  await new Promise(r => setTimeout(r, settle));
  const metrics = app.getAppMetrics(), pids = metrics.map(m => m.pid);
  const foot = {};
  for (const p of pids) { try { const out = cp.execFileSync('/usr/bin/footprint', ['-p', String(p)], {encoding: 'utf8', timeout: 15000, maxBuffer: 20e6}); const f = out.match(/Footprint:\s*([\d.]+)\s*(KB|MB|GB)/); if (f) foot[p] = Number(f[1]) * ({KB: 1 / 1024, MB: 1, GB: 1024}[f[2]]); } catch {} }
  const rows = metrics.map(m => ({pid: m.pid, type: m.type, name: m.name || m.serviceName || '', ws: Math.round(m.memory.workingSetSize / 1024 * 10) / 10, footprint: Math.round((foot[m.pid] || 0) * 10) / 10, rss: Math.round(m.memory.workingSetSize / 1024 * 10) / 10, hosts: views.filter(v => v.webContents.getOSProcessId() === m.pid).map(v => ({type: 'window', url: v.webContents.getURL().slice(0, 70)}))}));
  const totals = {ws: 0, footprint: 0, rss: 0}; for (const r of rows) { totals.ws += r.ws; totals.footprint += r.footprint; totals.rss += r.rss; }
  const mu = process.memoryUsage();
  console.log('RESULT' + JSON.stringify({main: {rss: mu.rss / 1048576, heapUsed: mu.heapUsed / 1048576, external: mu.external / 1048576, arrayBuffers: mu.arrayBuffers / 1048576}, rows, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v)]))}));
  app.quit();
});
setTimeout(() => process.exit(2), (settle + 60000));
