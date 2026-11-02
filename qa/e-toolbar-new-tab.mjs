// Pinned extension buttons on acira://new (stream E): load an action extension, pin it, open a website tab and the New Tab page, ask for the toolbar target of each.
import http from 'node:http';
import fs from 'node:fs/promises';
import {startApp, sleep} from './d-harness.mjs';
const folder = process.argv[2] || 'C:/ae/testext';
const server = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end('<title>t</title><h1>x</h1>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}/`;
await fs.rm('.qa-profiles/e-toolbar', {recursive: true, force: true});
const app = await startApp({root: '.qa-profiles/e-toolbar'});
try {
  await app.main(({dialog}, dir) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [dir]}); dialog.showMessageBox = async (...a) => ({response: (a.at(-1)?.buttons?.length === 2 ? 1 : 0), checkboxChecked: false}); }, folder);
  const profileId = (await app.state()).activeBrowserProfileId;
  const loaded = await app.ui.evaluate(id => window.acira.extensions({type: 'load', profileId: id}), profileId);
  if (!loaded.extensions?.[0]) console.log('LOAD FAILED', JSON.stringify(loaded).slice(0, 400)); const ext = loaded.extensions[0]; console.log('loaded', ext.name, 'hasAction', ext.hasAction);
  const pinned = await app.ui.evaluate(([id, e]) => window.acira.extensions({type: 'pin', profileId: id, extensionId: e, pinned: true}), [profileId, ext.id]);
  console.log('pinned', pinned.extensions[0].pinned);
  const targetFor = async tab => (await app.svc({type: 'extensions.toolbar-target', tabId: tab.id})).extensionToolbar;
  const lone = (await app.state()).tabs.find(t => t.url === 'acira://new'); await sleep(1500);
  console.log('lone New Tab page target:', JSON.stringify(await targetFor(lone)));
  const found = await app.ui.evaluate(() => { const lists = [...document.querySelectorAll('browser-action-list')]; const buttons = lists.flatMap(l => [...(l.shadowRoot || l).querySelectorAll('button,[is=browser-action]')]); buttons[0]?.click(); return {lists: lists.length, buttons: buttons.length}; });
  await sleep(2000); console.log('on the lone New Tab page, action buttons in the toolbar:', JSON.stringify(found), 'popup page opened:', app.context.pages().map(p => p.url()).filter(u => u.startsWith('chrome-extension://')));
  await app.act({type: 'tab.new', url: base}); await sleep(2500);
  let s = await app.state(); const web = s.tabs.find(t => t.url.startsWith(base));
  console.log('website tab target:', JSON.stringify(await targetFor(web)));
  await app.act({type: 'tab.new'}); await sleep(1500); s = await app.state();
  const fresh = s.tabs.find(t => t.url === 'acira://new');
  console.log('new tab page:', fresh ? fresh.url + ' (' + fresh.contentKind + ')' : 'none');
  console.log('new tab target:', JSON.stringify(await targetFor(fresh)));
} catch (error) { console.log('ERROR', error); } finally { await app.close(); server.close(); process.exit(0); }
