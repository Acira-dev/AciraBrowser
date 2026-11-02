// Stream D: a download still waiting for its save path when Acira quits comes back as Cancelled with Retry, not "Paused 0 KB" with no actions.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-download-restart'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => {
  if (req.url.startsWith('/file')) { res.writeHead(200, {'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="big.bin"', 'content-length': '400000'}); let sent = 0; const timer = setInterval(() => { if (res.destroyed || sent >= 400000) { clearInterval(timer); res.end(); return; } res.write(Buffer.alloc(20000, 1)); sent += 20000; }, 300); res.on('close', () => clearInterval(timer)); return; }
  res.setHeader('content-type', 'text/html'); res.end('<title>p</title>x');
});
const base = `http://127.0.0.1:${fx.port}`, report = [];
let app = await startApp({root});
try {
  await app.act({type: 'tab.new', url: base + '/'}); await app.waitWeb(base + '/'); await sleep(600);
  await app.ui.evaluate(() => window.acira.native({type: 'downloads.preferences.set', askWhere: true}));
  await app.main(({dialog}) => { dialog.showSaveDialog = () => new Promise(() => {}); }); // the person never answers the Save dialog
  await app.web(base + '/').evaluate(() => { const a = document.createElement('a'); a.href = '/file'; a.download = 'big.bin'; document.body.append(a); a.click(); });
  const waiting = await poll(async () => (await app.state()).downloads[0], Boolean, 'a download waiting for its save path', 15000); assert.equal(waiting.path, '');
  report.push('a download waiting for a save path is recorded (' + waiting.status + ', ' + waiting.size + ')');
} finally { await app.close(); }
app = await startApp({root});
try {
  await sleep(1500);
  const restored = (await app.state()).downloads[0];
  assert.equal(restored.status, 'Cancelled', 'not Paused'); assert.equal(restored.canRetry, true, 'Retry is offered straight from the snapshot'); assert.ok(!restored.canResume && !restored.canPause);
  report.push('after a restart it reads Cancelled with Retry, without opening the Downloads page first');
  await app.act({type: 'tab.new', url: base + '/'}); await app.waitWeb(base + '/'); await sleep(600);
  await app.ui.evaluate(() => window.acira.native({type: 'downloads.preferences.set', askWhere: false}));
  const before = (await app.state()).downloads.length;
  await app.svc({type: 'downloads.command', id: restored.id, command: 'retry'});
  await poll(async () => (await app.state()).downloads.length, n => n > before, 'Retry starts a new transfer', 15000); report.push('Retry starts the download again');
  console.log(JSON.stringify({ok: true, report}, null, 1));
} finally { await app.close(); await fx.close(); }
