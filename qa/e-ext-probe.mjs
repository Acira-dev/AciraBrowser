// Scratch-style probe (stream E): load a local unpacked extension on a disposable profile, open a local page, print what a content script saw.
//   node qa/e-ext-probe.mjs <extension folder> [attribute to read from <html>, default data-sync-probe]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import {startApp, sleep} from './d-harness.mjs';
const folder = path.resolve(process.argv[2] || ''), attribute = process.argv[3] || 'data-sync-probe';
const server = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end('<!doctype html><title>t</title><body><h1>Fixture</h1><input id="i"></body>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}/`;
await fs.rm('.qa-profiles/e-ext-probe', {recursive: true, force: true});
const app = await startApp({root: '.qa-profiles/e-ext-probe'});
try {
  await app.main(({dialog}, dir) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [dir]}); dialog.showMessageBox = async (...a) => ({response: (a.at(-1)?.buttons?.length === 2 ? 1 : 0), checkboxChecked: false}); }, folder);
  const profileId = (await app.state()).activeBrowserProfileId;
  const loaded = await app.ui.evaluate(id => window.acira.extensions({type: 'load', profileId: id}), profileId);
  for (const host of JSON.parse(process.env.PROBE_HOSTS || '[]')) { const id = (loaded.extensions || [])[0]?.id; await fs.mkdir('.qa-profiles/e-ext-probe/NativeMessagingHosts', {recursive: true}); await fs.writeFile('.qa-profiles/e-ext-probe/NativeMessagingHosts/' + host.name + '.json', JSON.stringify({name: host.name, description: 'qa', path: host.path, type: 'stdio', allowed_origins: host.forbid ? [] : ['chrome-extension://' + id + '/']})); }
console.log('loaded:', (loaded.extensions || []).map(e => e.name + ' ' + e.status).join(', '), loaded.error || '');
  await sleep(1500); await app.act({type: 'tab.new', url: base});
  let page; for (let i = 0; i < 40 && !page; i++) { page = app.web(base); await sleep(250); }
  await sleep(+process.env.PROBE_WAIT||2500);
  console.log(attribute + ':', await page.evaluate(a => document.documentElement.getAttribute(a), attribute));
} catch (error) { console.log("ERROR", error); } finally { await app.close(); server.close(); process.exit(0); }
