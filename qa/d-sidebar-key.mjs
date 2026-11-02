// Stream D: Ctrl+S toggles the sidebar only in sidebar-tabs mode (pref on); otherwise it is Save page.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-sidebar-key'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>p</title>x'); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root});
const ctrlS = url => app.main(({webContents}, u) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === u); wc.focus(); wc.sendInputEvent({type: 'keyDown', keyCode: 's', modifiers: ['control']}); wc.sendInputEvent({type: 'keyUp', keyCode: 's', modifiers: ['control']}); }, url);
const open = async () => (await app.state()).windowUi.webWorkspaceOpen, saves = () => app.main(() => globalThis.__saves);
try {
  await app.main(({dialog}) => { globalThis.__saves = 0; dialog.showSaveDialog = async () => { globalThis.__saves++; return {canceled: true}; }; });
  await app.act({type: 'tab.new', url: base + '/'}); await app.waitWeb(base + '/'); await sleep(700);
  // Classic layout: Ctrl+S = Save page.
  const startOpen = await open(); await ctrlS(base + '/'); await poll(saves, n => n === 1, 'save dialog'); assert.equal(await open(), startOpen); report.push('layout with a tab strip: Ctrl+S saves the page');
  // Sidebar-tabs layout: Ctrl+S toggles the sidebar and does not save.
  await app.act({type: 'settings.update', patch: {verticalTabs: true}}); await sleep(500);
  await ctrlS(base + '/'); await poll(open, v => v === !startOpen, 'sidebar toggled'); await ctrlS(base + '/'); await poll(open, v => v === startOpen, 'toggled back'); assert.equal(await saves(), 1); report.push('sidebar-tabs layout: Ctrl+S toggles the sidebar (twice = back), no Save dialog');
  // Pref off: falls through to Save page.
  await app.act({type: 'settings.update', patch: {sidebarShortcut: false}}); await sleep(300); await ctrlS(base + '/'); await poll(saves, n => n === 2, 'save with pref off'); assert.equal(await open(), startOpen); report.push('pref off: Ctrl+S saves even in sidebar-tabs layout');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
