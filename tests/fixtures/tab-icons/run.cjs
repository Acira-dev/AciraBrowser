'use strict';
// Electron runner for tests/tab-icons.test.cjs: icons come through the tab's session as data URLs; non-images, huge files and failures give ''.
const http = require('node:http'), path = require('node:path'), os = require('node:os');
const { app, session } = require('electron');
const { createTabIcons, MAX_BYTES } = require('../../../desktop/browser-services/tab-icons.cjs');
app.setPath('userData', path.join(os.tmpdir(), 'acira-tab-icons-' + process.pid));
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const hits = [];
const server = http.createServer((req, res) => {
  hits.push({ url: req.url, cookie: req.headers.cookie || '', ua: req.headers['user-agent'] });
  if (req.url === '/icon.png') { res.setHeader('content-type', 'image/png'); res.end(PNG); }
  else if (req.url === '/page.html') { res.setHeader('content-type', 'text/html'); res.end('<html>nope</html>'); }
  else if (req.url === '/huge.png') { res.setHeader('content-type', 'image/png'); res.end(Buffer.alloc(MAX_BYTES + 10)); }
  else if (req.url === '/redirect') { res.statusCode = 302; res.setHeader('location', '/icon.png'); res.end(); }
  else { res.statusCode = 404; res.end('no'); }
});
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const ses = session.fromPartition('tab-icons-' + process.pid); await ses.cookies.set({ url: base, name: 'tracker', value: '1' });
  const icons = createTabIcons({ timeoutMs: 3000 }), out = {};
  out.png = await icons.fetchIcon(ses, base + '/icon.png'); out.html = await icons.fetchIcon(ses, base + '/page.html'); out.huge = await icons.fetchIcon(ses, base + '/huge.png');
  out.missing = await icons.fetchIcon(ses, base + '/missing.ico'); out.redirect = await icons.fetchIcon(ses, base + '/redirect'); out.badScheme = await icons.fetchIcon(ses, 'file:///etc/passwd'); out.data = await icons.fetchIcon(ses, 'data:image/png;base64,AAAA');
  out.dead = await icons.fetchIcon(ses, 'http://127.0.0.1:1/x.png'); let before = hits.length; await icons.fetchIcon(ses, base + '/icon.png'); out.privateNotKept = hits.length === before + 1;
  const kept = { storagePath: 'C:/not-a-real-profile', fetch: (...args) => ses.fetch(...args) }; await icons.fetchIcon(kept, base + '/icon.png'); before = hits.length; await icons.fetchIcon(kept, base + '/icon.png'); out.cachedNoRequest = hits.length === before;
  out.cookieSent = hits.some(hit => hit.cookie.includes('tracker')); out.noElectronUa = hits.every(hit => !/electron/i.test(hit.ua || ''));
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n'); server.close(); app.exit(0);
});
