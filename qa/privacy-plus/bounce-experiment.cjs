'use strict';
// Does this Electron/Chromium runtime run Bounce Tracking Mitigations (DIPS) and delete bouncing trackers' state?
//   electron qa/privacy-plus/bounce-experiment.cjs --features="DIPS:grace_period/1s/timer_delay/3s/triggering_action/stateful_bounce" [--waitMs=14000] [--thirdparty=block|allow]
// a.test -> (script navigation) -> tracker.test sets a cookie and 302s -> b.test. Nobody interacts with tracker.test.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow, session } = require('electron');
const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
const features = arg('features', ''), WAIT = Number(arg('waitMs', 14000)), userData = path.join(os.tmpdir(), 'acira-bounce-' + process.pid);
app.setPath('userData', userData);
app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.test 127.0.0.1');
const enable = [features, arg('thirdparty', 'block') === 'block' ? 'ForceThirdPartyCookieBlockingEnabled' : ''].filter(Boolean).join(',');
if (enable) app.commandLine.appendSwitch('enable-features', enable);
process.on('uncaughtException', e => process.stderr.write('uncaught ' + e.stack + '\n'));
app.on('window-all-closed', () => { });
const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0], port = server.address().port;
  if (host === 'a.test') { res.setHeader('content-type', 'text/html'); res.end(`<script>setTimeout(()=>{location.href='http://tracker.test:${port}/bounce'},400)</script>start`); }
  else if (host === 'tracker.test' && req.url.startsWith('/bounce')) { res.statusCode = 302; res.setHeader('set-cookie', 'uid=abc123; Max-Age=3600; Path=/'); res.setHeader('location', `http://b.test:${port}/`); res.end(); }
  else { res.setHeader('content-type', 'text/html'); res.end('landed'); }
});
app.whenReady().then(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, ses = session.fromPartition('persist:bounce-test');
  const win = new BrowserWindow({ x: -2600, y: 0, width: 800, height: 600, show: true, webPreferences: { session: ses } });
  await win.loadURL(`http://a.test:${port}/`);
  await new Promise(r => setTimeout(r, 2500));
  const before = await ses.cookies.get({}); console.error('after bounce: url=' + win.webContents.getURL() + ' cookies=' + JSON.stringify(before.map(c => c.domain + ':' + c.name)));
  await new Promise(r => setTimeout(r, WAIT));
  const after = await ses.cookies.get({}); console.error('after wait: cookies=' + JSON.stringify(after.map(c => c.domain + ':' + c.name)));
  const files = []; const walk = (dir, depth) => { if (depth > 3) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (/^DIPS/i.test(e.name)) files.push(path.relative(userData, path.join(dir, e.name))); if (e.isDirectory()) { try { walk(path.join(dir, e.name), depth + 1); } catch { } } } }; walk(userData, 0);
  console.error('DIPS files: ' + JSON.stringify(files));
  console.error('RESULT ' + (before.some(c => /tracker\.test/.test(c.domain)) ? (after.some(c => /tracker\.test/.test(c.domain)) ? 'tracker cookie KEPT' : 'tracker cookie DELETED') : 'tracker cookie never stored'));
  app.exit(0);
});
