// Scratch rig for the P3 live check: one app, qa/p3-runtime/ext-a loaded with a snippet as its service worker (default) or its options page
// (PAGE=1); the snippet is an async expression whose string result is posted back and printed.  node qa/p3-debug.mjs <snippet.js>
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const snippet = process.argv[2] ? await fs.readFile(process.argv[2], 'utf8') : 'JSON.stringify(Object.keys(chrome.storage))';
const root = path.resolve('C:/ae/p3/dbg-' + Date.now());
let posted = null;
const server = http.createServer((req, res) => { res.setHeader('access-control-allow-origin', '*'); let body = ''; req.on('data', d => { body += d; }); req.on('end', () => { if (req.method === 'POST' && !req.url.includes('name=')) posted = body; res.end('ok'); }); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const runner = `const post = body => fetch(P3.server + '/report', {method: 'POST', body: String(body)});\n(async () => { try { post(await ${snippet}\n); } catch (e) { post('ERR ' + (e && e.stack || e)); } })();\n`;
const copy = async (name, config) => {
  const dir = path.join(root, name);
  await fs.mkdir(dir, {recursive: true});
  for (const f of await fs.readdir(path.resolve('qa/p3-runtime', name))) await fs.copyFile(path.resolve('qa/p3-runtime', name, f), path.join(dir, f));
  await fs.writeFile(path.join(dir, 'config.js'), `self.P3 = ${JSON.stringify(config)};\n`);
  if (name === 'ext-a') {
    if (process.env.PAGE) { await fs.writeFile(path.join(dir, 'page.js'), runner); await fs.writeFile(path.join(dir, 'sw.js'), "importScripts('config.js');\n"); }
    else await fs.writeFile(path.join(dir, 'sw.js'), "importScripts('config.js');\n" + runner);
  }
  return dir;
};
let app;
try {
  await (process.env.ACIRA_SLOT_HELD ? (work => work()) : work => withSlot('p3-debug', work))(async () => {
    app = await startApp({root: path.resolve('.qa-profiles', 'p3d' + Date.now().toString(36)), env: {ACIRA_DEV: '0'}});
    await app.main(({dialog}) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [globalThis.__p3Folder]}); dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; }; });
    const profileId = (await app.state()).activeBrowserProfileId;
    const ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId, ...request});
    const dirA = await copy('ext-a', {server: base, b: 'x'});
    await app.main((_m, d) => { globalThis.__p3Folder = d; }, dirA);
    const loaded = await ext({type: 'load'});
    console.log('loaded', (loaded.extensions || []).map(e => e.name));
    await app.act({type: 'tab.new', url: base + '/page'});
    if (process.env.PAGE) {
      const partition = (await app.state()).browserProfiles.find(p => p.id === profileId).partition, id = loaded.extensions[0].id;
      await app.main(({BrowserWindow, session}, a) => {
        const w = new BrowserWindow({show: false, width: 500, height: 400, webPreferences: {session: session.fromPartition(a.partition), sandbox: true, contextIsolation: true}});
        globalThis.__dbgPage = w; w.loadURL(a.url);
      }, {partition, url: 'chrome-extension://' + id + '/options.html'});
    }
    for (let i = 0; i < 120 && posted === null; i++) await sleep(500);
    console.log('POSTED', posted);
    console.log('APP LOG', (app.logs || []).join('').split(/\r?\n/).filter(line => line.includes('p3dbg')).join('\n'));
    console.log('EXTENSION PAGES', JSON.stringify(await app.main(({webContents}) => webContents.getAllWebContents().filter(wc => !wc.isDestroyed() && wc.getURL().startsWith('chrome-extension://')).map(wc => wc.getURL() + ' ' + wc.getType()))));
  });
} catch (error) { console.error(String(error && error.stack || error).slice(0, 2000)); }
finally { try { await app?.close(); } catch {} server.close(); }
