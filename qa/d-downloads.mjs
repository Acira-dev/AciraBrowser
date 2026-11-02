// Stream D: download lifecycle - progress, pause, resume, cancel, retry, open/reveal, dangerous files, multi-download prompt.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-downloads'; await fs.rm(root, {recursive: true, force: true});
const dlDir = path.resolve(root, 'saved'); const SIZE = 3 * 1024 * 1024;
const fx = await httpFixture((req, res) => {
  const range = /bytes=(\d+)-/.exec(req.headers.range || ''); const start = range ? Number(range[1]) : 0;
  if (req.url.startsWith('/slow') || req.url.startsWith('/tool.exe')) {
    const name = req.url.startsWith('/tool.exe') ? 'tool.exe' : 'slow.bin';
    res.statusCode = range ? 206 : 200; res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-disposition', `attachment; filename="${name}"`); res.setHeader('accept-ranges', 'bytes'); res.setHeader('etag', '"fixed"');
    res.setHeader('content-length', String(SIZE - start)); if (range) res.setHeader('content-range', `bytes ${start}-${SIZE - 1}/${SIZE}`);
    let sent = start; const iv = setInterval(() => { if (res.destroyed) return clearInterval(iv); res.write(Buffer.alloc(256 * 1024, 7)); sent += 256 * 1024; if (sent >= SIZE) { clearInterval(iv); res.end(); } }, 250); req.on('close', () => clearInterval(iv)); return;
  }
  res.setHeader('content-type', 'text/html'); res.end('<title>home</title>');
});
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root, env: {ACIRA_BROWSER_TEST_DOWNLOAD_DIR: dlDir}});
try {
  await app.main(({dialog, shell}) => { globalThis.__dialogs = []; globalThis.__answer = 1; globalThis.__shell = []; dialog.showMessageBox = async (...a) => { const o = a.at(-1); globalThis.__dialogs.push(o.title); return {response: globalThis.__answer}; }; shell.openPath = async p => { globalThis.__shell.push(['open', p]); return ''; }; shell.showItemInFolder = p => globalThis.__shell.push(['show', p]); });
  const dialogs = () => app.main(() => globalThis.__dialogs), shellCalls = () => app.main(() => globalThis.__shell);
  const downloads = async () => (await app.svc({type: 'downloads.list'})).downloads;
  const dl = (id, command) => app.svc({type: 'downloads.command', id, command});
  await app.act({type: 'tab.new', url: base + '/'}); await app.waitWeb(base + '/'); await sleep(500);
  const go = url => app.act({type: 'tab.navigate', url});
  // Start a slow download: progress is reported and bytes increase.
  await go(base + '/slow1'); let item = await poll(async () => (await downloads())[0], d => d?.status === 'Downloading' && d.receivedBytes > 0, 'downloading with progress', 15000);
  assert.equal(item.name, 'slow.bin'); assert.equal(item.totalBytes, SIZE); assert.ok(item.canPause && item.canCancel); report.push('progress reported');
  await dl(item.id, 'pause'); item = await poll(async () => (await downloads())[0], d => d?.status === 'Paused', 'paused'); const frozen = item.receivedBytes; await sleep(900); assert.equal((await downloads())[0].receivedBytes, frozen); assert.ok(item.canResume); report.push('pause stops bytes');
  await dl(item.id, 'resume'); item = await poll(async () => (await downloads())[0], d => d?.status === 'Ready', 'ready after resume', 30000);
  assert.equal((await fs.stat(item.path)).size, SIZE); assert.ok(item.canOpen && item.canShow); report.push('resume completes with full file');
  // Reveal / open call the OS shell (stubbed) with the saved path; nothing runs automatically.
  await dl(item.id, 'show'); await dl(item.id, 'open'); const calls = await shellCalls(); assert.deepEqual(calls.map(c => c[0]), ['show', 'open']); assert.equal(calls[0][1], item.path); report.push('open + reveal act on the saved file');
  // Second download inside 10s from the same tab asks first; Block cancels it.
  await app.main(() => { globalThis.__answer = 0; }); await go(base + '/slow2');
  await poll(dialogs, d => d.includes('Site permission'), 'multi-download prompt'); const second = await poll(async () => (await downloads()).find(d => d.id !== item.id), d => d && ['Cancelled', 'Interrupted'].includes(d.status), 'blocked download cancelled'); report.push('multi-download prompt (the site permission question) blocks (' + second.status + ')');
  // Block is remembered for the site: another burst is cancelled without asking. Resetting the permission asks again; Allow lets it through.
  { const before = (await dialogs()).length; await sleep(500); await go(base + '/slow2b'); await poll(async () => (await downloads()).filter(d => d.status === 'Cancelled' || d.status === 'Interrupted').length, n => n >= 2, 'second burst download cancelled', 15000); assert.equal((await dialogs()).length, before, 'a remembered Block does not ask again'); report.push('a remembered Block cancels the next burst download without asking'); }
  { const origin = new URL(base).origin; await app.svc({type: 'site.permission-reset', tabId: (await app.state()).activeTabId, requester: origin, embedder: origin, permission: 'multiple-downloads'}); }
  // Cancel mid-flight, then retry restarts it.
  await sleep(10500); await app.main(() => { globalThis.__answer = 1; }); await go(base + '/slow3');
  const live = await poll(async () => (await downloads()).find(d => d.status === 'Downloading'), Boolean, 'third download live', 15000); await dl(live.id, 'cancel');
  const cancelled = await poll(async () => (await downloads()).find(d => d.id === live.id), d => d.status === 'Cancelled', 'cancelled'); assert.ok(cancelled.canRetry); report.push('cancel');
  await dl(live.id, 'retry'); await poll(async () => (await downloads()).filter(d => d.name === 'slow.bin').length, n => n >= 3, 'retry started a new transfer', 15000); report.push('retry');
  // Dangerous executable: Open asks first and respects Cancel.
  await sleep(10500); await go(base + '/tool.exe'); const exe = await poll(async () => (await downloads()).find(d => d.name === 'tool.exe' && d.status === 'Ready'), Boolean, 'exe ready', 30000); assert.equal(exe.dangerous, true);
  await app.main(() => { globalThis.__answer = 0; globalThis.__shell = []; }); await dl(exe.id, 'open'); assert.deepEqual(await shellCalls(), []); assert.ok((await dialogs()).includes('Open downloaded file?')); report.push('dangerous file never auto-opens; Cancel keeps it closed');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
