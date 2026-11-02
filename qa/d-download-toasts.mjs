// Stream D: a download says so in a toast (A's bible §4): Show when it starts, Open when it is ready, Retry when it fails; Open and Show really work.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-download-toasts'; await fs.rm(root, {recursive: true, force: true});
const folder = path.resolve(root, 'saved'); await fs.mkdir(folder, {recursive: true});
const fx = await httpFixture((req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end('<title>home</title>home'); }
  if (req.url.startsWith('/slow')) { res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-disposition', 'attachment; filename="slow.bin"'); res.setHeader('content-length', '400000'); res.write(Buffer.alloc(1000, 1)); return; }
  res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-disposition', 'attachment; filename="report.bin"'); res.end(Buffer.alloc(50000, 3));
});
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root});
try {
  await app.main(({dialog, shell}, folder) => { globalThis.__opened = []; dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]}); shell.openPath = async target => { globalThis.__opened.push(target); return ''; }; }, folder);
  await app.ui.evaluate(() => window.acira.native({type: 'downloads.choose-folder'}));
  await app.act({type: 'tab.new', url: base + '/'}); await app.waitWeb(base + '/'); await sleep(300);
  // Start: "Downloading <name>" with Show. The slow file never finishes, so its toast is still the current one.
  await app.act({type: 'tab.navigate', url: base + '/slow'});
  const started = await poll(async () => (await app.state()).toast, t => t && /^Downloading /.test(t.text), 'start toast', 15000);
  assert.equal(started.text, 'Downloading slow.bin'); assert.equal(started.action?.label, 'Show'); assert.deepEqual(started.action.command, {type: 'ui.open', panel: 'downloads'});
  report.push('a starting download says "Downloading slow.bin" with Show');
  // Show opens the Downloads panel (the toast action is an ordinary dispatched action).
  await app.act(started.action.command);
  await poll(() => app.context.pages().some(p => { try { return p.url().includes('view=overlay'); } catch { return false; } }), Boolean, 'overlay renderer', 10000);
  await poll(async () => { for (const p of app.context.pages()) { try { if (p.url().includes('view=overlay') && await p.locator('.popup-content-downloads').count()) return true; } catch {} } return false; }, Boolean, 'downloads panel open', 10000);
  report.push('Show opens the Downloads panel');
  // Finish: "<name> downloaded" with Open; Open runs the file (stubbed here).
  await sleep(10500); await app.act({type: 'tab.navigate', url: base + '/file'});
  const ready = await poll(async () => (await app.state()).toast, t => t && /downloaded$/.test(t.text), 'finished toast', 15000);
  assert.equal(ready.text, 'report.bin downloaded'); assert.equal(ready.action?.label, 'Open'); assert.equal(ready.action.command.type, 'download.act'); assert.equal(ready.action.command.command, 'open');
  report.push('a finished download says "report.bin downloaded" with Open');
  await app.act(ready.action.command);
  const opened = await poll(() => app.main(() => globalThis.__opened), list => list.length > 0, 'file opened', 10000);
  assert.equal(path.basename(opened[0]), 'report.bin'); report.push('Open runs the saved file');
  // Bad actions never reach main.
  await assert.rejects(app.act({type: 'download.act', id: 'download-nope', command: 'open'}), /outside|scope|id/i); await assert.rejects(app.act({type: 'download.act', id: ready.action.command.id, command: 'delete'}), /Download action/);
  await assert.rejects(app.act({type: 'ui.open', panel: 'settings'}), /Panel/); report.push('unknown ids, commands and panels are refused');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
