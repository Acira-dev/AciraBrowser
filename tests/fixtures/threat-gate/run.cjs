'use strict';
// Electron runner for tests/threat-lists.test.cjs: real navigations in a real session, through the real lists and gate, against a local host that the lists name.
const http = require('node:http'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow, session } = require('electron');
const { createThreatLists, SOURCES } = require('../../../desktop/browser-services/threat-lists.cjs'), { createThreatGate } = require('../../../desktop/browser-services/threat-gate.cjs');
app.setPath('userData', path.join(os.tmpdir(), 'acira-threat-gate-' + process.pid));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const page = (title, extra = '') => `<!doctype html><title>${title}</title><body>${title}${extra}`;
const server = http.createServer((req, res) => {
  const routes = { '/phish/login': page('phish page'), '/phishing2': page('phishing2 page'), '/ok': page('ok page', '<script src="/payload.js"></script><script src="/clean.js"></script>'), '/malware/a': page('malware page'),
    '/payload.js': 'window.payloadRan = true', '/clean.js': 'window.cleanRan = true' };
  const body = routes[req.url.split('?')[0]]; res.statusCode = body ? 200 : 404; res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8'); res.end(body || 'not found');
});
const filler = title => `! Title: ${title}\n! Updated: 2026-10-24T12:00:00Z\n${Array.from({ length: 600 }, (_, i) => `filler-${i}.example.test`).join('\n')}\n`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const lists = createThreatLists({ cachePath: path.join(os.tmpdir(), 'acira-threat-lists-' + process.pid), download: async url => url.includes('phishing') ? filler(SOURCES[0].title) + '||127.0.0.1/phish^$all\n' : filler(SOURCES[1].title) + '||127.0.0.1/malware^$all\n||127.0.0.1/payload.js^$all\n' });
  await lists.refresh({}); const gate = createThreatGate({ lists });
  const ses = session.fromPartition('threat-gate-' + process.pid);
  ses.webRequest.onBeforeRequest((details, callback) => callback(gate.check(details, details.webContents, 'profile-1')));
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { session: ses, sandbox: true, contextIsolation: true } }), wc = win.webContents;
  const navigate = async url => { const failed = new Promise(resolve => wc.once('did-fail-load', (_event, code, description, address, isMain) => { if (isMain) resolve({ errorCode: code, description }); })); const loaded = wc.loadURL(url).then(() => ({ ok: true })).catch(() => null); const outcome = await Promise.race([failed, loaded.then(value => value && value.ok ? {} : new Promise(() => { }))]); await sleep(150); return outcome; };
  const result = {};
  const blocked = await navigate(base + '/phish/login'); result.phishNavigation = { ...blocked, status: gate.status(wc.id, base + '/phish/login') };
  await navigate(base + '/ok'); await sleep(300); result.okPage = { title: await wc.executeJavaScript('document.title'), payloadRan: await wc.executeJavaScript('window.payloadRan === true'), cleanScriptRan: await wc.executeJavaScript('window.cleanRan === true') };
  await navigate(base + '/phishing2'); result.boundary = { title: await wc.executeJavaScript('document.title') };
  const malware = await navigate(base + '/malware/a'); result.malware = { ...malware, status: gate.status(wc.id, base + '/malware/a') };
  await navigate(base + '/phish/login'); const allowed = gate.allow(wc.id, base + '/phish/login', 'profile-1'); await navigate(base + '/phish/login'); result.afterContinue = { allowed, title: await wc.executeJavaScript('document.title') };
  result.stats = gate.stats();
  process.stdout.write('RESULT ' + JSON.stringify(result) + '\n'); server.close(); app.exit(0);
});
