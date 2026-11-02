// Stream D: downloads save straight into the chosen folder (no Save dialog) unless "ask where" is on; names never collide.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-download-folder'; await fs.rm(root, {recursive: true, force: true});
const folder = path.resolve(root, 'my downloads'); await fs.mkdir(folder, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-disposition', 'attachment; filename="report.bin"'); res.end(Buffer.alloc(50000, 3)); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root});
try {
  await app.main(({dialog}, folder) => { globalThis.__saveCalls = 0; globalThis.__pick = folder; dialog.showSaveDialog = async () => { globalThis.__saveCalls++; return {canceled: true}; }; dialog.showOpenDialog = async () => ({canceled: false, filePaths: [globalThis.__pick]}); dialog.showMessageBox = async () => ({response: 1}); }, folder);
  const native = r => app.ui.evaluate(r => window.acira.native(r), r), saveCalls = () => app.main(() => globalThis.__saveCalls), prefs = async () => (await native({type: 'downloads.preferences'})).downloads.preferences;
  let p = await prefs(); assert.equal(p.askWhere, false); assert.equal(p.customFolder, false); report.push('default: no prompt, folder = ' + path.basename(p.folder));
  await assert.rejects(native({type: 'downloads.preferences.set', folder: 'relative/path'}), /existing folder/); report.push('bad folder rejected');
  p = (await native({type: 'downloads.choose-folder'})).downloads.preferences; assert.equal(p.folder, folder); assert.equal(p.customFolder, true); report.push('folder chosen through the native chooser');
  await app.act({type: 'tab.new', url: base + '/'}); await sleep(300);
  const go = () => app.act({type: 'tab.navigate', url: base + '/file?' + Math.random()});
  await go(); await poll(() => fs.readFile(path.join(folder, 'report.bin')).then(b => b.length === 50000, () => false), Boolean, 'saved without a dialog', 20000); assert.equal(await saveCalls(), 0); report.push('download saved straight into the chosen folder, no Save dialog');
  await sleep(10500); await go(); await poll(() => fs.readFile(path.join(folder, 'report (1).bin')).then(b => b.length === 50000, () => false), Boolean, 'second copy', 20000); report.push('second download gets "report (1).bin", nothing overwritten');
  await native({type: 'downloads.preferences.set', askWhere: true}); await sleep(10500); await go(); await poll(saveCalls, n => n >= 1, 'Save dialog when asked'); report.push('"ask where to save" brings back the Save dialog');
  await native({type: 'downloads.preferences.set', askWhere: false, folder: null}); assert.equal((await prefs()).customFolder, false); report.push('reset to the default folder');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
