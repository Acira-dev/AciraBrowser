// Stream D: Save as PDF / Save page produce real files; Print asks the system dialog.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-output'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Printable doc</title><h1>Quarterly report</h1><p>' + 'Readable paragraph. '.repeat(60) + '</p>'); });
const base = `http://127.0.0.1:${fx.port}`, report = [], out = path.resolve(root);
const app = await startApp({root});
try {
  await app.act({type: 'tab.new', url: base + '/doc'}); await app.waitWeb(base + '/doc'); await sleep(800);
  const tab = (await app.state()).tabs.at(-1);
  await app.main(({dialog}, out) => { globalThis.__saves = []; globalThis.__next = null; dialog.showSaveDialog = async (...a) => { const o = a.at(-1); globalThis.__saves.push(o.defaultPath); return globalThis.__next ? {canceled: false, filePath: globalThis.__next} : {canceled: true}; }; }, out);
  // Cancel writes nothing.
  await app.cmd({type: 'save-pdf', tabId: tab.id}); await sleep(600); assert.equal((await app.main(() => globalThis.__saves)).length, 1);
  assert.match(path.basename((await app.main(() => globalThis.__saves))[0]), /^Printable doc\.pdf$/); report.push('default file name comes from the page title');
  await app.main((_, p) => { globalThis.__next = p; }, path.join(out, 'report.pdf')); await app.cmd({type: 'save-pdf', tabId: tab.id});
  const pdf = await poll(() => fs.readFile(path.join(out, 'report.pdf')).catch(() => null), b => b && b.length > 1000, 'pdf written'); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); report.push('Save as PDF writes a real PDF (' + pdf.length + ' bytes)');
  assert.equal((await fs.readdir(out)).some(n => n.endsWith('.tmp')), false); report.push('no temp files left');
  await app.main((_, p) => { globalThis.__next = p; }, path.join(out, 'page.html')); await app.cmd({type: 'save-page', tabId: tab.id});
  const html = await poll(() => fs.readFile(path.join(out, 'page.html'), 'utf8').catch(() => null), Boolean, 'html written'); assert.match(html, /Quarterly report/); report.push('Save page as writes the document');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
