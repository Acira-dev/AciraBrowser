// P7 real-app check: chrome.downloads from an extension's service worker on Acira's real downloads manager.
// Isolated profile (.qa-profiles/p7*), one app, one native slot, downloads from a LOCAL server into a folder inside the test profile.
//   node qa/p7-downloads-live.mjs [--out <result.json>]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(arg('--out') || path.join('qa/artifacts/p7-downloads', stamp, 'result.json'));
const extRoot = path.resolve(process.platform==='win32'?'C:/ae/p7':'.qa-profiles/p7-fixtures', stamp);
const extDir = path.join(extRoot, 'ext');

const seen = [];
let report = null, pageReport = null;
const histEvents = [];
const server = await new Promise(resolve => {
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    seen.push({path: url.pathname, headers: req.headers});
    if (req.method === 'OPTIONS') { res.writeHead(204, {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}); res.end(); return; }
    if (req.method === 'POST' && url.pathname === '/hist') {
      let body = ''; req.on('data', d => { body += d; });
      req.on('end', () => { try { histEvents.push(JSON.parse(body)); } catch {} res.writeHead(200, {'access-control-allow-origin': '*'}); res.end('ok'); });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/report-page') {
      let body = ''; req.on('data', d => { body += d; });
      req.on('end', () => { try { pageReport = JSON.parse(body); } catch { pageReport = {error: 'bad report'}; } res.writeHead(200, {'access-control-allow-origin': '*'}); res.end('ok'); });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/report') {
      let body = ''; req.on('data', d => { body += d; });
      req.on('end', () => { try { report = JSON.parse(body); } catch { report = {error: 'bad report'}; } res.writeHead(200, {'access-control-allow-origin': '*'}); res.end('ok'); });
      return;
    }
    const text = (body, type = 'text/plain', extra = {}) => { res.writeHead(200, {'content-type': type, 'content-length': Buffer.byteLength(body), ...extra}); res.end(body); };
    if (url.pathname === '/file/a.txt') return text('hello a\n');
    if (url.pathname === '/file/a2.txt') return text('hello a2 (overwritten)\n');
    if (url.pathname === '/file/b.txt') return text('hello b via redirect\n');
    if (url.pathname === '/redir') { res.writeHead(302, {location: '/file/b.txt'}); res.end(); return; }
    if (url.pathname === '/attach') return text('server named this\n', 'application/octet-stream', {'content-disposition': 'attachment; filename="server-name.dat"'});
    if (url.pathname === '/echo-headers') return text(JSON.stringify(req.headers, null, 1), 'application/json');
    if (url.pathname === '/secure/c.txt') {
      if (!/(?:^|; )sid=p7(?:;|$)/.test(req.headers.cookie || '')) { res.writeHead(403, {'content-type': 'text/plain'}); res.end('no cookie'); return; }
      return text('secret for a signed-in profile\n');
    }
    if (url.pathname === '/slow') {
      const n = Number(url.searchParams.get('n') || 6), chunk = Buffer.alloc(1024, 0x61);
      res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': n * 1024, 'accept-ranges': 'none'});
      let sent = 0;
      const timer = setInterval(() => { if (res.destroyed || sent >= n) { clearInterval(timer); if (!res.destroyed) res.end(); return; } res.write(chunk); sent++; }, 300);
      res.on('close', () => clearInterval(timer));
      return;
    }
    if (url.pathname === '/missing') { res.writeHead(404, {'content-type': 'text/plain'}); res.end('missing'); return; }
    res.writeHead(200, {'content-type': 'text/html'}); res.end('<!doctype html><title>p7</title><h1>p7 fixture</h1>');
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

await fs.mkdir(extDir, {recursive: true});
for (const file of await fs.readdir('qa/p7-downloads/extension')) await fs.copyFile(path.join('qa/p7-downloads/extension', file), path.join(extDir, file));
await fs.writeFile(path.join(extDir, 'config.js'), `self.P7 = ${JSON.stringify({base})};\n`);
const manifest = {manifest_version: 3, name: 'P7 downloads check', version: '1.0', permissions: ['downloads', 'downloads.open', 'history'], host_permissions: ['<all_urls>'], background: {service_worker: 'sw.js'}};
await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const checks = [];
const check = (name, ok, detail) => { checks.push({name, ok: !!ok, detail: ok ? undefined : detail}); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + JSON.stringify(detail).slice(0, 300))); };
const until = async (read, ms, every = 400) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await read(); if (v) return v; await sleep(every); } return null; };
const result = {started: new Date().toISOString(), base};
let app;
try {
  await withSlot('p7-downloads-live', async () => {
    const root = path.resolve('.qa-profiles', 'p7' + Date.now().toString(36)), dl = path.join(root, 'dl');
    app = await startApp({root, env: {ACIRA_DEV: '0', ACIRA_BROWSER_TEST_DOWNLOAD_DIR: dl}});
    await app.main(({dialog}, folder) => {
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]});
      dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
    }, extDir);
    const state = await app.state();
    const profileId = state.activeBrowserProfileId, partition = state.browserProfiles.find(p => p.id === profileId).partition;
    // The profile is signed in to the local server: /secure only answers with this cookie.
    await app.main(async ({session}, args) => { await session.fromPartition(args.partition).cookies.set({url: args.base, name: 'sid', value: 'p7', path: '/'}); }, {partition, base});
    const loaded = await app.ui.evaluate(request => window.acira.extensions(request), {profileId, type: 'load'});
    const entry = (loaded.extensions || []).find(e => e.name === manifest.name);
    if (!entry) throw new Error('the check extension did not load: ' + JSON.stringify(loaded).slice(0, 300));
    result.extensionId = entry.id;
    await app.act({type: 'tab.new', url: base + '/page'});
    const got = await until(() => report, 90000);
    if (!got) throw new Error('the service worker never reported');
    // The extension page (a popup / options page / side panel is the same world): a blob: URL made in the page, and search from a page.
    await app.main(({BrowserWindow, session}, args) => {
      const w = new BrowserWindow({show: false, width: 500, height: 400, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
      globalThis.__p7Page = w; w.loadURL(args.url);
    }, {partition, url: `chrome-extension://${entry.id}/page.html?base=${encodeURIComponent(base)}`});
    const pageGot = await until(() => pageReport, 60000);
    result.pageReport = pageGot;
    // History events: a visit is reported to the extension, deleting it from History reports the removal.
    await app.act({type: 'tab.new', url: base + '/visit-a'});
    const visited = await until(() => histEvents.find(e => e.type === 'visited' && e.item.url.endsWith('/visit-a')), 20000);
    result.histVisited = visited || null;
    const visit = (await app.state()).browsingHistory.find(v => v.url.endsWith('/visit-a'));
    if (visit) await app.act({type: 'history.delete', ids: [visit.id]});
    const removed = await until(() => histEvents.find(e => e.type === 'removed'), 20000);
    result.histRemoved = removed || null;
    await sleep(500);
    const after = await app.state();
    result.report = got;
    result.records = after.downloads.map(({id, name, path: p, status, url, finalUrl, mime, byExtensionId, byExtensionName, receivedBytes, totalBytes, endedAt, browserProfileId}) => ({id, name, path: p, status, url, finalUrl, mime, byExtensionId, byExtensionName, receivedBytes, totalBytes, hasEnd: !!endedAt, browserProfileId}));
    const files = {};
    const walk = async dir => { for (const e of await fs.readdir(dir, {withFileTypes: true}).catch(() => [])) { const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else files[path.relative(dl, p).replace(/\\/g, '/')] = (await fs.readFile(p, 'utf8').catch(() => '')).slice(0, 600); } };
    await walk(dl);
    result.files = files;

    const r = got.results, ev = got.events, ok = name => r[name]?.ok;
    check('plain download completes', ok('plain') && r.plain.value.item.state === 'complete', r.plain);
    check('plain: filename is under the test download folder with the requested subfolder', (r.plain.value?.item.filename || '').replace(/\\/g, '/').endsWith('/dl/p7/a.txt'), r.plain);
    check('plain: attributed to the extension, size and mime known', r.plain.value?.item.byExtensionId === entry.id && r.plain.value.item.totalBytes === 8 && r.plain.value.item.bytesReceived === 8 && /^text\/plain/.test(r.plain.value.item.mime), r.plain);
    check('plain: file on disk has the served bytes', files['p7/a.txt'] === 'hello a2 (overwritten)\n' || files['p7/a.txt'] === 'hello a\n', files);
    check('uniquify makes "a (1).txt"', ok('uniquify') && (r.uniquify.value.filename || '').replace(/\\/g, '/').endsWith('/p7/a (1).txt') && files['p7/a (1).txt'] === 'hello a\n', [r.uniquify, Object.keys(files)]);
    check('overwrite replaces a.txt', ok('overwrite') && files['p7/a.txt'] === 'hello a2 (overwritten)\n', [r.overwrite, files['p7/a.txt']]);
    const sent = JSON.parse(files['p7/headers.json'] || '{}');
    check('custom headers reach the server (X-P7, Authorization)', sent['x-p7'] === 'hello' && sent.authorization === 'Bearer t0k', sent);
    check('redirect: url is the first address, finalUrl the last', ok('redirect') && r.redirect.value.url.endsWith('/redir') && r.redirect.value.finalUrl.endsWith('/file/b.txt') && files['p7/redirected.txt'] === 'hello b via redirect\n', r.redirect);
    check('no filename: the server\'s Content-Disposition name is used', ok('attachment-name') && files['server-name.dat'] === 'server named this\n', [r['attachment-name'], Object.keys(files)]);
    check('the profile\'s cookies are sent (signed-in download works)', ok('cookies') && r.cookies.value.state === 'complete' && files['p7/secure.txt'] === 'secret for a signed-in profile\n', r.cookies);
    check('404 ends interrupted, not complete, and does not hang', ok('not-found') && r['not-found'].value.state === 'interrupted', r['not-found']);
    check('connection refused ends interrupted (or is refused) and does not hang', (ok('refused-port') && r['refused-port'].value.state === 'interrupted') || (r['refused-port'] && !r['refused-port'].ok), r['refused-port']);
    check('data: URL downloads', ok('data-url') && r['data-url'].value.state === 'complete' && files['p7/data.txt'] === 'hello data', [r['data-url'], files['p7/data.txt']]);
    const pr = r['pause-resume'];
    check('pause stops progress, resume finishes', ok('pause-resume') && pr.value.paused.paused === true && pr.value.stillPaused === true && pr.value.noProgressWhilePaused && pr.value.done.state === 'complete' && pr.value.done.bytesReceived === 8192, pr);
    check('cancel ends interrupted with USER_CANCELED', ok('cancel') && r.cancel.value.state === 'interrupted' && r.cancel.value.error === 'USER_CANCELED', r.cancel);
    check('search: all, query, order, limit, state, regex', ok('search') && r.search.value.total >= 10 && r.search.value.byQuery.length === 1 && r.search.value.sortedIds.length === 3 && r.search.value.regex === 1 && r.search.value.complete >= 6, r.search);
    check('invalid options give Chromium\'s errors', ok('invalid') && r.invalid.value.url === 'Invalid URL' && r.invalid.value.filename === 'Invalid filename' && r.invalid.value.header === 'Unsafe request header name' && r.invalid.value.badId === 'Invalid downloadId', r.invalid);
    check('erase forgets the download but not the file', ok('erase') && r.erase.value.erased.length === 1 && r.erase.value.after === 0 && files['p7/data.txt'] === 'hello data', [r.erase, files['p7/data.txt']]);
    check('onCreated fired for every started download', ev.created.length >= 11 && ev.created.every(c => c.byExtensionId === entry.id), ev.created);
    check('onChanged reported completion (state in_progress -> complete) and an interruption', ev.changed.some(d => d.state && d.state.current === 'complete') && ev.changed.some(d => d.state && d.state.current === 'interrupted'), ev.changed.slice(0, 6));
    check('onChanged reported the pause', ev.changed.some(d => d.paused && d.paused.current === true) && ev.changed.some(d => d.paused && d.paused.current === false), ev.changed.filter(d => d.paused));
    check('onErased fired', ev.erased.length === 1, ev.erased);
    const mine = result.records.filter(rec => rec.byExtensionId === entry.id);
    check('the Downloads page knows the extension\'s downloads (same records)', mine.length >= 11 && result.records.some(rec => rec.name === 'a.txt' && rec.status === 'Ready'), result.records.slice(0, 4));
    check('an extension page can search too', pageGot && pageGot.pageSearch && pageGot.pageSearch.ok && pageGot.pageSearch.total >= 11, pageGot);
    check('blob: URL made in an extension page downloads with its bytes', pageGot && pageGot.blob && pageGot.blob.ok && pageGot.blob.state === 'complete' && files['p7/blob.txt'] === 'hello from a blob', [pageGot && pageGot.blob, files['p7/blob.txt']]);
    check('history.onVisited reports a page visit with its address, title and count', result.histVisited && result.histVisited.item.visitCount >= 1 && typeof result.histVisited.item.lastVisitTime === 'number' && /visit-a$/.test(result.histVisited.item.url), result.histVisited);
    check('history.onVisitRemoved reports the deleted page', result.histRemoved && result.histRemoved.info && (result.histRemoved.info.allHistory === true || (result.histRemoved.info.urls || []).some(u => u.endsWith('/visit-a'))), result.histRemoved);
    check('the app is still alive', await app.main(() => true).then(() => true, () => false));
  });
} catch (error) {
  result.error = String(error && error.stack || error).slice(0, 2000);
  console.error(result.error);
} finally {
  try { await app?.close(); } catch {}
  server.close();
}
result.checks = checks; result.finished = new Date().toISOString();
await fs.mkdir(path.dirname(out), {recursive: true});
await fs.writeFile(out, JSON.stringify(result, null, 1));
const failed = checks.filter(c => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} checks passed; wrote ${out}`);
process.exit(result.error || failed.length || !checks.length ? 1 : 0);
