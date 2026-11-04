'use strict';
// Electron runner for tests/color-scheme-hint.test.cjs. Wires sessions the way main.cjs configureSession does (the real request pipeline, the identity
// participant, then color-scheme-hint.cjs) and loads pages from two local servers (four secure origins) that ask for every client hint there is, with
// and without Critical-CH. Records every request the servers saw (path, label, hint headers) and, per page, what the page itself reads for
// prefers-color-scheme. Usage: electron run.cjs <userData> <phase: first|restart|crash> <port> <port> [--without] (--without: no colour hint participant, for the
// before run). The same two ports in both phases keep the four origins the same across the restart.
const http = require('node:http'), path = require('node:path'), fs = require('node:fs');
const { app, BrowserWindow, session, nativeTheme } = require('electron');
for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
// Electron's argv keeps its own switches before the script; the arguments are the ones after it.
const args = process.argv.slice(process.argv.findIndex(arg => arg.endsWith('run.cjs')) + 1), without = args.includes('--without');
const [userData, phase = 'first', ...ports] = args.filter(arg => !arg.startsWith('--'));
if (!userData || !path.isAbsolute(userData)) { process.stdout.write('ERROR an absolute userData folder is required\n'); process.exit(2); }
app.setPath('userData', userData);
app.on('window-all-closed', () => { });
const root = path.join(__dirname, '..', '..', '..', 'desktop');
const { RequestPipeline } = require(path.join(root, 'request-pipeline.cjs'));
const { addNativeHints } = require(path.join(root, 'browser-services', 'chrome-identity.cjs'));
const torIdentity = require(path.join(root, 'browser-services', 'tor-identity.cjs'));
const hint = require(path.join(root, 'browser-services', 'color-scheme-hint.cjs'));
// Every hint a site can list in Accept-CH today; only Sec-CH-Prefers-Color-Scheme may ever be added.
const ALL_HINTS = ['Sec-CH-Prefers-Color-Scheme', 'Sec-CH-UA-Arch', 'Sec-CH-UA-Bitness', 'Sec-CH-UA-Full-Version', 'Sec-CH-UA-Full-Version-List', 'Sec-CH-UA-Model', 'Sec-CH-UA-Platform-Version',
  'Sec-CH-UA-WoW64', 'Sec-CH-UA-Form-Factors', 'Sec-CH-Prefers-Reduced-Motion', 'Sec-CH-Prefers-Reduced-Transparency', 'Sec-CH-Device-Memory', 'Sec-CH-DPR', 'Sec-CH-Width', 'Sec-CH-Viewport-Width',
  'Sec-CH-Viewport-Height', 'Device-Memory', 'DPR', 'Width', 'Viewport-Width', 'Downlink', 'RTT', 'ECT', 'Save-Data', 'Sec-CH-Save-Data'];
const requests = [];
const seen = headers => Object.fromEntries(Object.entries(headers).filter(([name]) => /^sec-ch-|^(?:device-memory|dpr|width|viewport-width|downlink|rtt|ect|save-data)$/i.test(name)));
function handler(req, res) {
  const url = new URL(req.url, 'http://x'), label = url.searchParams.get('s') || '';
  requests.push({ host: req.headers.host, path: url.pathname, label, method: req.method, hints: seen(req.headers) });
  const scheme = req.headers['sec-ch-prefers-color-scheme'] || 'none', html = body => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>' + label + '</title><body data-scheme="' + scheme.replace(/[^a-z]/g, '') + '">' + body); };
  if (url.pathname === '/ask') { res.setHeader('Accept-CH', ALL_HINTS.join(', ')); return html(''); }
  if (url.pathname === '/critical') { res.setHeader('Accept-CH', ALL_HINTS.join(', ')); res.setHeader('Critical-CH', 'Sec-CH-Prefers-Color-Scheme, Sec-CH-UA-Model'); res.setHeader('Vary', 'Sec-CH-Prefers-Color-Scheme'); return html(''); }
  if (url.pathname === '/withdraw') { res.setHeader('Accept-CH', 'Sec-CH-UA-Arch'); return html(''); }
  if (url.pathname === '/sub') { res.setHeader('access-control-allow-origin', '*'); res.setHeader('content-type', 'text/plain'); res.setHeader('Accept-CH', ALL_HINTS.join(', ')); res.end(scheme); return; }
  if (url.pathname === '/frame') { res.setHeader('Accept-CH', ALL_HINTS.join(', ')); return html('frame'); }
  if (url.pathname === '/form') return html(`<form method=post action="/critical?s=${encodeURIComponent(label)}-post"><button>go</button></form>`);
  html('');
}
const servers = [http.createServer(handler), http.createServer(handler)];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessions = new Map();
function wire(kind) {
  if (sessions.has(kind)) return sessions.get(kind);
  const ses = kind === 'profile' ? session.fromPartition('persist:acira-hint-profile') : session.fromPartition(kind + '-' + process.pid);
  if (!without) hint.guard?.(ses); // content-blocking.cjs does this the first time it sees a session, before anything else
  const pipeline = new RequestPipeline(ses);
  pipeline.useSendHeaders(kind === 'tor' ? details => torIdentity.sendHeaders(torIdentity.torIdentity(), details) : details => addNativeHints(details));
  if (!without) hint.attach(ses, pipeline, { remember: kind === 'profile' });
  sessions.set(kind, ses); return ses;
}
const PROBE = `(async () => { const sub = async url => { try { return await (await fetch(url)).text(); } catch { return 'failed'; } };
  const frame = src => new Promise(resolve => { const f = document.createElement('iframe'); f.src = src; f.onload = () => resolve(true); document.body.appendChild(f); setTimeout(() => resolve(false), 3000); });
  const nav = performance.getEntriesByType('navigation')[0];
  return { media: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', served: document.body.dataset.scheme, redirects: nav ? nav.redirectCount : null,
    same: await sub('/sub?s=' + document.title + '-same'), cross: await sub(OTHER + '/sub?s=' + document.title + '-cross'), frame: await frame('/frame?s=' + document.title + '-frame'), crossFrame: await frame(OTHER + '/frame?s=' + document.title + '-crossframe') };
})()`;
app.whenReady().then(async () => {
  for (const [index, server] of servers.entries()) await new Promise(resolve => server.listen(Number(ports[index]) || 0, '127.0.0.1', resolve));
  const [a, b] = servers.map(server => server.address().port);
  const origin = { A: `http://127.0.0.1:${a}`, B: `http://localhost:${a}`, C: `http://127.0.0.1:${b}`, D: `http://localhost:${b}` };
  const out = [], windows = new Map();
  const win = kind => { if (!windows.has(kind)) windows.set(kind, new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { session: wire(kind), sandbox: true, contextIsolation: true } })); return windows.get(kind); };
  async function visit(kind, url, other, label) {
    const w = win(kind), before = w.webContents.navigationHistory.length();
    await w.loadURL(url).catch(error => out.push({ label, loadError: String(error) })); await sleep(100);
    const page = await w.webContents.executeJavaScript(PROBE.replaceAll('OTHER', JSON.stringify(other))).catch(error => ({ error: String(error) }));
    out.push({ label, kind, theme: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors, entries: w.webContents.navigationHistory.length() - before, ...page });
  }
  const readList = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).origins : null;
  if (phase === 'crash') {
    // The start after a crash or force quit with "clear cookies on exit" on: profile-cleanup.cjs clears cookies (keeping the sites the person keeps) through
    // the pipeline content-blocking.cjs made, before configureSession attaches the hint. The saved list must lose the same sites.
    nativeTheme.themeSource = 'dark';
    const ses = session.fromPartition('persist:acira-hint-profile'); hint.guard?.(ses); // (absent before the fix: the run then shows the stale list)
    const file = path.join(ses.getStoragePath(), hint.FILE);
    out.push({ label: 'c-before', origins: readList(file) });
    await ses.clearData({ dataTypes: ['cookies'], excludeOrigins: [origin.B], originMatchingMode: 'origin-in-all-contexts' });
    out.push({ label: 'c-cleared', origins: readList(file) });
    await visit('profile', `${origin.A}/plain?s=c1`, origin.B, 'c1');
    await visit('profile', `${origin.B}/plain?s=c2`, origin.A, 'c2');
  } else if (phase === 'restart') {
    // Same profile folder, a new app run: the first page of an origin that asked last time already carries the hint, in the profile only.
    nativeTheme.themeSource = 'dark';
    await visit('profile', `${origin.A}/plain?s=r1`, origin.B, 'r1');
    await visit('private', `${origin.A}/plain?s=r2`, origin.B, 'r2');
    const file = path.join(wire('profile').getStoragePath(), hint.FILE);
    out.push({ label: 'r-file', file: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null });
    // Clearing only the cache keeps the list; clearing a site's cookies forgets that site; clearing all cookies forgets everything.
    await wire('profile').clearData({ dataTypes: ['cache'] });
    await visit('profile', `${origin.A}/plain?s=r3`, origin.B, 'r3');
    await wire('profile').clearData({ dataTypes: ['cookies'], origins: [origin.C] }); // site 127.0.0.1 (cookies ignore ports): A and C go, B stays
    await visit('profile', `${origin.C}/plain?s=r4`, origin.D, 'r4');
    await visit('profile', `${origin.A}/plain?s=r5`, origin.B, 'r5');
    await visit('profile', `${origin.B}/plain?s=r6`, origin.A, 'r6');
    await wire('profile').clearStorageData({ storages: ['cookies'] });
    await visit('profile', `${origin.B}/plain?s=r7`, origin.A, 'r7');
    out.push({ label: 'r-file-after', exists: fs.existsSync(file) });
  } else {
    nativeTheme.themeSource = 'light';
    await visit('profile', `${origin.A}/plain?s=p1`, origin.B, 'p1'); // no site asked yet
    await visit('profile', `${origin.A}/ask?s=p2`, origin.B, 'p2'); // asks (no Critical-CH): this page goes without
    await visit('profile', `${origin.A}/plain?s=p3`, origin.B, 'p3'); // light, with same-origin requests and frames
    nativeTheme.themeSource = 'dark';
    await visit('profile', `${origin.A}/plain?s=p4`, origin.B, 'p4'); // the next page after the switch is dark
    nativeTheme.themeSource = 'system';
    await visit('profile', `${origin.A}/plain?s=p5`, origin.B, 'p5'); // follows the system, like the page
    nativeTheme.themeSource = 'dark';
    // B is another origin; a frame of B inside A gets nothing even after B asked as a top-level page.
    await visit('profile', `${origin.B}/ask?s=p6`, origin.A, 'p6');
    await visit('profile', `${origin.A}/plain?s=p7`, origin.B, 'p7');
    // Critical-CH on an origin that never asked: loaded once more with the hint, one history entry.
    await visit('profile', `${origin.C}/critical?s=p8`, origin.D, 'p8');
    await visit('profile', `${origin.C}/critical?s=p9`, origin.D, 'p9'); // asked already: one request
    // Critical-CH answering a form post on an origin that never asked: never sent twice.
    await visit('private', `${origin.D}/form?s=p10`, origin.C, 'p10-form');
    const w = win('private'); await w.webContents.executeJavaScript('document.querySelector("form").submit(); 0'); await sleep(800);
    out.push({ label: 'p10', served: await w.webContents.executeJavaScript('document.body.dataset.scheme').catch(() => null), url: w.webContents.getURL() });
    // A withdrawal: a later Accept-CH without the hint.
    await visit('profile', `${origin.D}/ask?s=p11`, origin.C, 'p11');
    await visit('profile', `${origin.D}/plain?s=p12`, origin.C, 'p12');
    await visit('profile', `${origin.D}/withdraw?s=p13`, origin.C, 'p13');
    await visit('profile', `${origin.D}/plain?s=p14`, origin.C, 'p14');
    // Private and Tor sessions learn the same way and keep nothing on disk; the private session's list is its own.
    await visit('private', `${origin.A}/plain?s=q1`, origin.B, 'q1');
    await visit('private', `${origin.A}/ask?s=q2`, origin.B, 'q2');
    await visit('private', `${origin.A}/plain?s=q3`, origin.B, 'q3');
    await visit('tor', `${origin.A}/ask?s=t1`, origin.B, 't1');
    await visit('tor', `${origin.A}/plain?s=t2`, origin.B, 't2');
    await sleep(700); // the profile's list is written half a second after it changes
    const file = path.join(wire('profile').getStoragePath(), hint.FILE);
    out.push({ label: 'file', file: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null, privatePath: wire('private').getStoragePath(), torPath: wire('tor').getStoragePath() });
  }
  for (const w of windows.values()) w.destroy();
  process.stdout.write('RESULT ' + JSON.stringify({ origin, out, requests }) + '\n');
  for (const server of servers) server.close();
  app.exit(0);
});
