'use strict';
// Electron runner for tests/tab-icons.test.cjs: icons come through the tab's session as data URLs; non-images, huge files and failures give ''.
const http = require('node:http'), path = require('node:path'), os = require('node:os');
const { app, session, BrowserWindow, nativeImage } = require('electron');
const { png, ico, svg } = require('./pictures.cjs');
const { readPageLinks, needFor } = require('../../../desktop/browser-services/icon-pick.cjs');
const { createTabIcons, MAX_BYTES } = require('../../../desktop/browser-services/tab-icons.cjs');
app.on('window-all-closed', () => {}); // closing the first page window must not quit the app before the second page is tried
app.setPath('userData', path.join(os.tmpdir(), 'acira-tab-icons-' + process.pid));
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
process.on('unhandledRejection', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const hits = [];
const server = http.createServer((req, res) => {
  hits.push({ url: req.url, cookie: req.headers.cookie || '', ua: req.headers['user-agent'] });
  if (req.url === '/icon.png') { res.setHeader('content-type', 'image/png'); res.end(PNG); }
  else if (req.url === '/page.html') { res.setHeader('content-type', 'text/html'); res.end('<html>nope</html>'); }
  else if (req.url === '/huge.png') { res.setHeader('content-type', 'image/png'); res.end(Buffer.alloc(MAX_BYTES + 10)); }
  else if (req.url === '/set/16.png') { res.setHeader('content-type', 'image/png'); res.end(png(16)); }
  else if (req.url === '/set/32.png') { res.setHeader('content-type', 'image/png'); res.end(png(32)); }
  else if (req.url === '/set/all.ico') { res.setHeader('content-type', 'image/vnd.microsoft.icon'); res.end(ico([16, 32, 48])); }
  else if (req.url === '/set/touch.png') { res.setHeader('content-type', 'image/png'); res.end(png(180)); }
  else if (req.url === '/set/vec.svg') { res.setHeader('content-type', 'image/svg+xml'); res.end(svg()); }
  else if (req.url === '/icons.html' || req.url === '/sandboxed.html') {
    if (req.url === '/sandboxed.html') res.setHeader('content-security-policy', "sandbox allow-same-origin; script-src 'none'; object-src 'none'");
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html><head><title>icons</title><link rel="apple-touch-icon" sizes="180x180" href="/set/touch.png"><link rel="icon" sizes="16x16" href="/set/16.png"><link rel="icon" sizes="32x32" href="/set/32.png"><link rel="shortcut icon" href="/set/all.ico"><link rel="mask-icon" href="/set/vec.svg"></head><body>page</body></html>');
  }
  else if (req.url === '/redirect') { res.statusCode = 302; res.setHeader('location', '/icon.png'); res.end(); }
  else { res.statusCode = 404; res.end('no'); }
});
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const ses = session.fromPartition('tab-icons-' + process.pid); await ses.cookies.set({ url: base, name: 'tracker', value: '1' });
  const icons = createTabIcons({ timeoutMs: 3000, nativeImage }), out = {};
  out.png = await icons.fetchIcon(ses, base + '/icon.png'); out.html = await icons.fetchIcon(ses, base + '/page.html'); out.huge = await icons.fetchIcon(ses, base + '/huge.png');
  out.missing = await icons.fetchIcon(ses, base + '/missing.ico'); out.redirect = await icons.fetchIcon(ses, base + '/redirect'); out.badScheme = await icons.fetchIcon(ses, 'file:///etc/passwd'); out.data = await icons.fetchIcon(ses, 'data:image/png;base64,AAAA');
  out.dead = await icons.fetchIcon(ses, 'http://127.0.0.1:1/x.png'); let before = hits.length; await icons.fetchIcon(ses, base + '/icon.png'); out.privateNotKept = hits.length === before + 1;
  const kept = { storagePath: 'C:/not-a-real-profile', fetch: (...args) => ses.fetch(...args) }; await icons.fetchIcon(kept, base + '/icon.png'); before = hits.length; await icons.fetchIcon(kept, base + '/icon.png'); out.cachedNoRequest = hits.length === before;
  out.cookieSent = hits.some(hit => hit.cookie.includes('tracker')); out.noElectronUa = hits.every(hit => !/electron/i.test(hit.ua || ''));
  // A real page: its <link> tags are read in an isolated world (also under a script-blocking sandbox), and the right file is fetched and nothing else.
  for (const name of ['icons', 'sandboxed']) {
    const win = new BrowserWindow({ show: false, webPreferences: { session: session.fromPartition('tab-icons-page-' + name + process.pid) } });
    try { await win.loadURL(base + '/' + name + '.html'); } catch (error) { out[name] = { error: String(error && error.message || error) }; win.destroy(); continue; }
    const links = await readPageLinks(win.webContents), mark = hits.length, got = [];
    await icons.resolvePageIcon(win.webContents, { announced: [base + '/set/16.png', base + '/set/32.png', base + '/set/all.ico'], pageUrl: win.webContents.getURL(), need: needFor(2), deliver: (icon) => got.push(icon && { url: icon.url.slice(base.length), width: icon.width, type: icon.type }) });
    out[name] = { links: links && links.map((link) => link.rel + ' ' + link.href.slice(base.length)), got, fetched: hits.slice(mark).map((hit) => hit.url).filter((url) => url.startsWith('/set/')) };
    win.destroy();
  }
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n'); server.close(); app.exit(0);
});
