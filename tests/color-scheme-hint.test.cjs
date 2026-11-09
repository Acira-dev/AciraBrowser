'use strict';
// Sec-CH-Prefers-Color-Scheme (desktop/browser-services/color-scheme-hint.cjs). Google and Bing list it in Accept-CH and draw their light or dark page on the
// server from it; Electron sent none of the hints a site asks for, so the first search after Acira or the Mac turned dark came out light (Bing stayed light).
// The Electron runner (fixtures/color-scheme-hint/run.cjs) loads local pages that ask for every client hint there is, with and without Critical-CH, through the
// real request pipeline, and records what the servers received and what each page reads for prefers-color-scheme. A second run on the same profile folder
// stands for a restart. The control run (no colour participant) shows the problem: a dark page asked for the hint and never got it.
const { test } = require('node:test'), assert = require('node:assert/strict'), { spawnSync } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os'), net = require('node:net');
const hint = require('../desktop/browser-services/color-scheme-hint.cjs');
const electron = (() => { try { const value = require('electron'); return typeof value === 'string' && fs.existsSync(value) ? value : null; } catch { return null; } })();
const UA_TRIO = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];

function fakeSession(folder) {
  const calls = [];
  return { calls, getStoragePath: () => folder, clearStorageData(options) { calls.push(['clearStorageData', options]); return Promise.resolve('storage'); }, clearData(options) { calls.push(['clearData', options]); return Promise.resolve('data'); } };
}
function fakePipeline() { const p = { sending: [], headers: [] }; p.useSendHeaders = h => p.sending.push(h); p.useHeaders = h => p.headers.push(h); return p; }
const page = (url, extra = {}) => ({ url, resourceType: 'mainFrame', method: 'GET', statusCode: 200, ...extra });

test('only secure origins count: https, and http on this computer', () => {
  assert.equal(hint.secureOrigin('https://www.google.com/search?q=x'), 'https://www.google.com');
  assert.equal(hint.secureOrigin('http://127.0.0.1:8080/a'), 'http://127.0.0.1:8080');
  assert.equal(hint.secureOrigin('http://localhost/'), 'http://localhost');
  for (const url of ['http://example.com/', 'http://google.com.localhost.evil/', 'file:///etc/passwd', 'data:text/html,x', 'about:blank', '', null, undefined]) assert.equal(hint.secureOrigin(url), null, String(url));
});

test('a site asks with Accept-CH and gets only this hint, with the value the pages read; an Accept-CH without it withdraws it; no header changes nothing', () => {
  let dark = false; const session = fakeSession(null), pipeline = fakePipeline();
  hint.attach(session, pipeline, { dark: () => dark });
  const [send] = pipeline.sending, [received] = pipeline.headers, url = 'https://www.bing.com/search?q=a';
  assert.deepEqual(send({ ...page(url), requestHeaders: { 'User-Agent': 'x' } }), {}, 'nothing before the site asks');
  assert.deepEqual(received({ ...page(url), responseHeaders: { 'accept-ch': ['Sec-CH-UA-Arch, Sec-CH-UA-Model, Downlink, ECT, Sec-CH-Prefers-Color-Scheme, Sec-CH-UA-Full-Version-List'] } }), {});
  assert.deepEqual(send({ ...page(url), requestHeaders: { 'User-Agent': 'x' } }), { requestHeaders: { 'User-Agent': 'x', 'Sec-CH-Prefers-Color-Scheme': 'light' } });
  dark = true;
  assert.equal(send({ ...page(url), requestHeaders: {} }).requestHeaders['Sec-CH-Prefers-Color-Scheme'], 'dark', 'follows a switch at once');
  assert.deepEqual(send({ ...page(url), requestHeaders: { 'sec-ch-prefers-color-scheme': 'light' } }), {}, 'a value already there is left alone');
  assert.deepEqual(send({ ...page('https://bing.com/'), requestHeaders: {} }), {}, 'another origin of the same site has not asked');
  assert.deepEqual(received({ ...page(url), responseHeaders: { 'X-Other': ['1'] } }), {});
  assert.ok(send({ ...page(url), requestHeaders: {} }).requestHeaders, 'a response without Accept-CH changes nothing');
  received({ ...page(url), responseHeaders: { 'Accept-CH': ['Sec-CH-UA-Arch'] } });
  assert.deepEqual(send({ ...page(url), requestHeaders: {} }), {}, 'withdrawn');
  received({ ...page(url), responseHeaders: { 'Accept-CH': ['Sec-CH-Prefers-Color-Scheme'] } }); received({ ...page(url), responseHeaders: { 'Accept-CH': [''] } });
  assert.deepEqual(send({ ...page(url), requestHeaders: {} }), {}, 'an empty Accept-CH withdraws too');
  // Only a top-level page response of a secure origin can ask.
  received({ url: 'https://ads.example/frame', resourceType: 'subFrame', method: 'GET', statusCode: 200, responseHeaders: { 'Accept-CH': ['Sec-CH-Prefers-Color-Scheme'] } });
  received({ ...page('http://plain.example/'), responseHeaders: { 'Accept-CH': ['Sec-CH-Prefers-Color-Scheme'] } });
  assert.deepEqual(send({ ...page('https://ads.example/x'), requestHeaders: {} }), {});
  assert.deepEqual(send({ ...page('http://plain.example/x'), requestHeaders: {} }), {});
});

test('an origin that asked gets the hint on its own requests and frames only while it is the page in the tab', () => {
  const session = fakeSession(null), pipeline = fakePipeline(); hint.attach(session, pipeline, { dark: () => true });
  const [send] = pipeline.sending, [received] = pipeline.headers, google = 'https://www.google.com';
  received({ ...page(google + '/'), responseHeaders: { 'accept-ch': ['Sec-CH-Prefers-Color-Scheme', 'Downlink', 'RTT'] } });
  const tab = url => ({ getURL: () => url });
  const sub = (url, top, site, type = 'xhr') => send({ url, resourceType: type, method: 'GET', webContents: tab(top), requestHeaders: site ? { 'Sec-Fetch-Site': site } : {} });
  assert.ok(sub(google + '/complete/search?q=x', google + '/search?q=x', 'same-origin').requestHeaders, 'same-origin request of the page');
  assert.ok(sub(google + '/frame', google + '/search?q=x', 'same-origin', 'subFrame').requestHeaders, 'same-origin frame');
  assert.ok(sub(google + '/x', google + '/search?q=x', null).requestHeaders, 'no Sec-Fetch-Site visible: the page is the same origin');
  assert.deepEqual(sub(google + '/x', 'https://example.com/', 'cross-site'), {}, 'the opted-in origin as a third party');
  assert.deepEqual(sub(google + '/x', google + '/', 'cross-site'), {}, 'from a frame of another site inside it');
  assert.deepEqual(sub('https://www.gstatic.com/x.js', google + '/', 'same-site', 'script'), {}, 'another origin of the same site');
  assert.deepEqual(send({ url: google + '/sw', resourceType: 'xhr', method: 'GET', requestHeaders: {} }), {}, 'no page behind it (a service worker)');
});

test('Critical-CH: the first page of an origin that just asked is loaded once more with the hint (GET only), keeping the response headers', () => {
  const session = fakeSession(null), pipeline = fakePipeline(); hint.attach(session, pipeline, { dark: () => true });
  const [, received] = [pipeline.sending[0], pipeline.headers[0]], url = 'https://www.google.com/search?q=a';
  const asks = { 'accept-ch': ['Sec-CH-Prefers-Color-Scheme, Sec-CH-UA-Model'], 'critical-ch': ['Sec-CH-UA-Model, Sec-CH-Prefers-Color-Scheme'], 'set-cookie': ['a=1'], location: ['https://elsewhere.example/'] };
  assert.deepEqual(received({ ...page('https://post.example/', { method: 'POST' }), responseHeaders: asks }), {}, 'a form post is never sent twice');
  assert.deepEqual(received({ ...page('https://moved.example/', { statusCode: 302 }), responseHeaders: asks }), {}, 'a redirect is followed as it is');
  const restart = received({ ...page(url), responseHeaders: asks });
  assert.equal(restart.statusLine, 'HTTP/1.1 307 Temporary Redirect');
  assert.deepEqual(restart.responseHeaders.Location, [url]); assert.equal(restart.responseHeaders.location, undefined, 'one Location, to the same address');
  assert.deepEqual(restart.responseHeaders['set-cookie'], ['a=1']);
  assert.deepEqual(received({ ...page(url), responseHeaders: asks }), {}, 'the second load carried the hint: no loop');
  const other = fakeSession(null), p2 = fakePipeline(); hint.attach(other, p2, { dark: () => true });
  assert.deepEqual(p2.headers[0]({ ...page(url), responseHeaders: { 'accept-ch': ['Sec-CH-UA-Model'], 'critical-ch': ['Sec-CH-Prefers-Color-Scheme'] } }), {}, 'critical but not asked for: nothing');
  assert.deepEqual(p2.headers[0]({ ...page(url), responseHeaders: { 'accept-ch': ['Sec-CH-Prefers-Color-Scheme'], 'critical-ch': ['Sec-CH-UA-Model'] } }), {}, 'asked for but not critical: nothing');
});

test('clearing cookies forgets the sites it clears, and only calls that clear cookies do', () => {
  assert.deepEqual(hint.clearedBy('clearStorageData', undefined), { all: true });
  assert.deepEqual(hint.clearedBy('clearStorageData', { storages: ['cookies'] }), { all: true });
  assert.deepEqual(hint.clearedBy('clearStorageData', { storages: ['localstorage', 'indexdb'] }), null);
  assert.deepEqual(hint.clearedBy('clearStorageData', { origin: 'https://www.google.com', storages: ['cookies'] }), { origins: ['https://www.google.com'] });
  assert.deepEqual(hint.clearedBy('clearData', undefined), { all: true });
  assert.deepEqual(hint.clearedBy('clearData', { dataTypes: ['cache'] }), null);
  assert.deepEqual(hint.clearedBy('clearData', { dataTypes: ['cookies'], origins: ['https://www.bing.com/'] }), { origins: ['https://www.bing.com'] });
  assert.deepEqual(hint.clearedBy('clearData', { dataTypes: ['cookies'], excludeOrigins: ['https://keep.example'] }), { except: ['https://keep.example'] });
});

test('an ordinary profile keeps the list in its own folder; clearing writes at once; private and Tor sessions write nothing', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hint-unit-')), file = path.join(folder, hint.FILE);
  try {
    const session = fakeSession(folder), pipeline = fakePipeline(); hint.attach(session, pipeline, { remember: true, dark: () => false });
    const [received] = pipeline.headers;
    for (const url of ['https://www.google.com/', 'https://www.google.de/', 'https://www.bing.com/', 'https://keep.example/']) received({ ...page(url), responseHeaders: { 'Accept-CH': ['Sec-CH-Prefers-Color-Scheme'] } });
    assert.equal(fs.existsSync(file), false, 'not written in the request callback');
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).origins, ['https://www.google.com', 'https://www.google.de', 'https://www.bing.com', 'https://keep.example']);
    // A restart: a new session object on the same folder reads it back (a damaged or foreign entry is dropped).
    fs.writeFileSync(file, JSON.stringify({ version: 1, origins: ['https://www.google.com', 'javascript:alert(1)', 'http://plain.example', 'https://www.bing.com/path', 42, 'https://www.bing.com'] }));
    const again = fakeSession(folder), p2 = fakePipeline(); hint.attach(again, p2, { remember: true, dark: () => true });
    assert.equal(p2.sending[0]({ ...page('https://www.google.com/search'), requestHeaders: {} }).requestHeaders['Sec-CH-Prefers-Color-Scheme'], 'dark');
    assert.ok(p2.sending[0]({ ...page('https://www.bing.com/'), requestHeaders: {} }).requestHeaders);
    assert.deepEqual(p2.sending[0]({ ...page('http://plain.example/'), requestHeaders: {} }), {});
    // The session's own clearing calls still run, with the same arguments and result.
    assert.equal(await again.clearData({ dataTypes: ['cache'] }), 'data');
    assert.ok(p2.sending[0]({ ...page('https://www.bing.com/'), requestHeaders: {} }).requestHeaders, 'the cache is not cookies');
    assert.equal(await again.clearData({ dataTypes: ['cookies'], origins: ['https://bing.com'] }), 'data');
    assert.deepEqual(again.calls.at(-1), ['clearData', { dataTypes: ['cookies'], origins: ['https://bing.com'] }]);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).origins, ['https://www.google.com'], 'the whole site bing.com is forgotten, written at once');
    await again.clearStorageData();
    assert.equal(fs.existsSync(file), false, 'an empty list leaves no file');
    // Private: no folder is ever written, whatever the session reports.
    const privateFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hint-private-')), quiet = fakeSession(privateFolder), p3 = fakePipeline();
    hint.attach(quiet, p3, { remember: false, dark: () => true });
    p3.headers[0]({ ...page('https://www.google.com/'), responseHeaders: { 'Accept-CH': ['Sec-CH-Prefers-Color-Scheme'] } });
    assert.ok(p3.sending[0]({ ...page('https://www.google.com/'), requestHeaders: {} }).requestHeaders);
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.deepEqual(fs.readdirSync(privateFolder), []); fs.rmSync(privateFolder, { recursive: true, force: true });
    // At most 500 origins are kept, the oldest go first.
    const many = fakeSession(folder), p4 = fakePipeline(); hint.attach(many, p4, { remember: true, dark: () => true });
    for (let i = 0; i < 520; i++) p4.headers[0]({ ...page(`https://s${i}.example/`), responseHeaders: { 'Accept-CH': ['Sec-CH-Prefers-Color-Scheme'] } });
    await new Promise(resolve => setTimeout(resolve, 650));
    const kept = JSON.parse(fs.readFileSync(file, 'utf8')).origins; assert.equal(kept.length, 500); assert.equal(kept[0], 'https://s20.example');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('cookies cleared before the hint is attached (the startup cleanup after a crash with clear-on-quit) clean the saved list on disk too', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hint-guard-')), file = path.join(folder, hint.FILE);
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, origins: ['https://www.google.com', 'https://www.bing.com', 'https://keep.example'] }));
    const session = fakeSession(folder); hint.guard(session);
    assert.equal(await session.clearData({ dataTypes: ['cache'] }), 'data');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).origins.length, 3, 'the cache is not cookies');
    assert.equal(await session.clearData({ dataTypes: ['cookies'], excludeOrigins: ['https://keep.example'], originMatchingMode: 'origin-in-all-contexts' }), 'data');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).origins, ['https://keep.example'], 'only the kept site stays, written at once');
    // Attached afterwards (configureSession), the hint goes only where the list still allows; the wrap is not doubled.
    const pipeline = fakePipeline(); hint.attach(session, pipeline, { remember: true, dark: () => true });
    assert.deepEqual(pipeline.sending[0]({ ...page('https://www.google.com/search?q=x'), requestHeaders: {} }), {}, 'google.com does not learn it was visited');
    assert.equal(pipeline.sending[0]({ ...page('https://keep.example/'), requestHeaders: {} }).requestHeaders['Sec-CH-Prefers-Color-Scheme'], 'dark');
    session.calls.length = 0; await session.clearStorageData();
    assert.equal(session.calls.length, 1, 'one call reaches the session'); assert.equal(fs.existsSync(file), false);
    // A session with no folder (private, Tor) or no list: nothing to do, the call still goes through.
    const bare = fakeSession(null); hint.guard(bare); assert.equal(await bare.clearData(), 'data');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('every session is guarded by content-blocking.cjs before the startup cleanup can clear its cookies', () => {
  const blocking = fs.readFileSync(path.join(__dirname, '../desktop/content-blocking.cjs'), 'utf8');
  const attach = blocking.slice(blocking.indexOf('function attach(session,profileId,privateMode){'));
  assert.ok(attach.indexOf("require('./browser-services/color-scheme-hint.cjs').guard(session);") >= 0 && attach.indexOf("require('./browser-services/color-scheme-hint.cjs').guard(session);") < attach.indexOf('const pipeline=new RequestPipeline(session);'), 'guarded the first time content blocking sees the session');
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  assert.match(main, /createProfileCleanup\(\{[^]*?getPipeline:\(session,id\)=>contentBlocking\.attach\(session,id,false\)/, "profile cleanup's pipeline is content blocking's");
  const cleanup = fs.readFileSync(path.join(__dirname, '../desktop/profile-cleanup.cjs'), 'utf8');
  assert.match(cleanup, /prepare\(values\)\{remember\(values\);return serialized\(/, 'the pipelines (and so the guard) exist before the startup cleanup runs');
  assert.match(cleanup, /pipeline=getPipeline\(session,profile\.id\)/);
});

test('main.cjs attaches it to every browsing session after the identity hints, remembering on disk for ordinary profiles only', () => {
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const at = main.indexOf('function configureSession('), body = main.slice(at, main.indexOf('\nfunction ', at + 10));
  assert.ok(at > 0 && body.includes("require('./browser-services/color-scheme-hint.cjs').attach(ses,pipeline,{remember:!profileId.startsWith('private-')&&!(languageOptions.tor||torMode),dark:details=>{"));
  assert.ok(body.includes('siteAppearance.darkFor(details?.webContents') && body.includes('nativeTheme.shouldUseDarkColors'), 'a tab told Light or Dark by Website appearance sends that scheme; every other tab follows Acira');
  assert.ok(body.indexOf('applyWebsiteLanguages(ses,pipeline') < body.indexOf('color-scheme-hint.cjs'), 'after the Sec-CH-UA participant');
  const source = fs.readFileSync(path.join(__dirname, '../desktop/browser-services/color-scheme-hint.cjs'), 'utf8');
  assert.equal((source.match(/requestHeaders: \{/g) || []).length, 1, 'one header is ever added');
  assert.match(source, /\[HINT\]: state\.dark\(details\) \? 'dark' : 'light'/);
});

// The Electron runs: real sessions, the real pipeline and identity participant, two local servers (four origins), every hint asked for.
function freePorts(count) {
  const script = `const net=require('net');(async()=>{const out=[];for(let i=0;i<${count};i++)out.push(await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});}));console.log(out.join(' '));})();`;
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }).stdout.trim().split(' ');
}
const runs = {}; let problem = '';
if (electron) {
  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }; delete env.ELECTRON_RUN_AS_NODE;
  const ports = freePorts(2), runner = path.join(__dirname, 'fixtures', 'color-scheme-hint', 'run.cjs');
  const run = (name, folder, phase, ...extra) => {
    const result = spawnSync(electron, ['--use-mock-keychain', runner, folder, phase, ...ports, ...extra], { encoding: 'utf8', timeout: 90000, env });
    const line = (result.stdout || '').split(/\r?\n/).find(text => text.startsWith('RESULT '));
    if (line) runs[name] = JSON.parse(line.slice(7)); else problem += `${name}: ` + ((result.stdout || '') + (result.stderr || '')).split(/\r?\n/).filter(text => !/^\[\d+:/.test(text)).join('\n').slice(0, 400) + '\n';
  };
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hint-control-')), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hint-'));
  const crashed = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-hint-crash-'));
  try {
    run('control', control, 'first', '--without'); run('first', profile, 'first');
    fs.cpSync(profile, crashed, { recursive: true }); // the same learned profile, for a start after a crash
    run('restart', profile, 'restart'); run('crash', crashed, 'crash');
  } finally { for (const folder of [control, profile, crashed]) fs.rmSync(folder, { recursive: true, force: true }); }
}
const skip = !electron ? 'electron binary not available' : false;
const step = (name, label) => runs[name].out.find(item => item.label === label);
const seen = (name, label) => runs[name].requests.filter(item => item.label === label);
const schemeOf = item => item.hints['sec-ch-prefers-color-scheme'] || null;

test('the Electron runs finished', { skip }, () => { assert.ok(runs.control && runs.first && runs.restart && runs.crash, problem); });

test('control, before this fix: a dark page asks for the hint and never gets it', { skip }, () => {
  for (const label of ['p3', 'p4', 'p7', 'p9']) {
    assert.equal(seen('control', label)[0].hints['sec-ch-prefers-color-scheme'], undefined, label);
    assert.equal(step('control', label).served, 'none');
  }
  assert.equal(step('control', 'p4').media, 'dark', 'the page itself reads dark');
});

test('a page that asked gets its hint on the next load, light then dark the moment the appearance switches, always equal to what the page reads', { skip }, () => {
  assert.equal(seen('first', 'p1')[0].hints['sec-ch-prefers-color-scheme'], undefined, 'nobody asked yet');
  assert.equal(schemeOf(seen('first', 'p2')[0]), null, 'the page that asks goes without (no Critical-CH)');
  for (const [label, value] of [['p3', 'light'], ['p4', 'dark'], ['p5', null], ['p7', 'dark']]) {
    const page = step('first', label), expected = value || page.media;
    assert.equal(page.served, expected, `${label}: served ${page.served}, theme ${page.theme}`);
    assert.equal(page.media, expected, `${label}: the page reads ${page.media}`);
    assert.equal(page.same, expected, `${label}: the page's own requests`);
    assert.equal(schemeOf(seen('first', label + '-frame')[0]), expected, `${label}: a frame of the same origin`);
  }
  assert.equal(step('first', 'p5').theme, 'system');
});

test('never to another origin, and no other hint is ever added (only the Sec-CH-UA trio and this one), in profile, private and Tor sessions', { skip }, () => {
  for (const name of ['first', 'restart']) for (const request of runs[name].requests) {
    const extra = Object.keys(request.hints).filter(key => !UA_TRIO.includes(key) && key !== 'sec-ch-prefers-color-scheme');
    assert.deepEqual(extra, [], `${name} ${request.label}: ${extra}`);
    for (const key of UA_TRIO) assert.ok(key in request.hints, `${name} ${request.label} keeps ${key}`);
    if (/-cross(?:frame)?$/.test(request.label)) assert.equal(schemeOf(request), null, `${name} ${request.label} went to another origin`);
  }
  // B asked as a top-level page (p6); as a frame or request inside A it still gets nothing.
  assert.ok(seen('first', 'p7-cross').length && seen('first', 'p7-crossframe').length);
});

test('Critical-CH: the first page is loaded once more with the hint, one history entry; a later page is loaded once; a form post is never sent twice', { skip }, () => {
  const first = seen('first', 'p8');
  assert.deepEqual(first.map(schemeOf), [null, 'dark']);
  const page = step('first', 'p8'); assert.equal(page.served, 'dark'); assert.equal(page.entries, 1, 'one history entry'); assert.ok(page.redirects <= 1);
  assert.deepEqual(seen('first', 'p9').map(schemeOf), ['dark']);
  const post = seen('first', 'p10-post'); assert.equal(post.length, 1); assert.equal(post[0].method, 'POST'); assert.equal(step('first', 'p10').served, 'none');
});

test('an Accept-CH without the hint withdraws it', { skip }, () => {
  assert.deepEqual(['p11', 'p12', 'p13', 'p14'].map(label => schemeOf(seen('first', label)[0])), [null, 'dark', 'dark', null]);
});

test('private and Tor sessions learn for themselves, in memory; the profile keeps its list on disk and has it after a restart', { skip }, () => {
  assert.equal(schemeOf(seen('first', 'q1')[0]), null, 'a private session does not inherit the profile');
  assert.equal(schemeOf(seen('first', 'q3')[0]), 'dark');
  assert.equal(schemeOf(seen('first', 't2')[0]), 'dark', 'Tor follows the page the same way (it reads the same media query)');
  const file = step('first', 'file'); assert.equal(file.privatePath, null); assert.equal(file.torPath, null);
  const { A, B, C } = runs.first.origin; assert.deepEqual([...file.file.origins].sort(), [A, B, C].sort());
  assert.equal(schemeOf(seen('restart', 'r1')[0]), 'dark', 'the first page after a restart is right');
  assert.equal(schemeOf(seen('restart', 'r2')[0]), null, 'a private window after a restart starts empty');
  assert.equal(schemeOf(seen('restart', 'r3')[0]), 'dark', 'clearing the cache keeps it');
  assert.deepEqual(['r4', 'r5', 'r6'].map(label => schemeOf(seen('restart', label)[0])), [null, null, 'dark'], "clearing one site's cookies forgets that site only");
  assert.equal(schemeOf(seen('restart', 'r7')[0]), null, 'clearing all cookies forgets everything');
  assert.equal(step('restart', 'r-file-after').exists, false);
});

test('a start after a crash with clear-on-quit: the startup cleanup clears the saved list with the cookies, keeping the kept sites; the first page carries no hint', { skip }, () => {
  const { A, B, C } = runs.crash.origin;
  assert.deepEqual([...step('crash', 'c-before').origins].sort(), [A, B, C].sort(), 'the learned list from the run before');
  assert.deepEqual(step('crash', 'c-cleared').origins, [B], 'only the site whose cookies are kept');
  assert.equal(schemeOf(seen('crash', 'c1')[0]), null, 'google-like A cannot tell it was visited before');
  assert.equal(schemeOf(seen('crash', 'c2')[0]), 'dark', 'the kept site still gets it');
});

test('the hint asks the colour source per request (Website appearance can tell one tab Light or Dark while Acira shows the other)', () => {
  const asked = []; const session = fakeSession(null), pipeline = fakePipeline();
  hint.attach(session, pipeline, { dark: details => { asked.push(details.webContents); return details.webContents === 'dark-tab'; } });
  const [send] = pipeline.sending, [received] = pipeline.headers, url = 'https://www.bing.com/search?q=a';
  received({ ...page(url), responseHeaders: { 'accept-ch': ['Sec-CH-Prefers-Color-Scheme'] } });
  assert.equal(send({ ...page(url), webContents: 'dark-tab', requestHeaders: {} }).requestHeaders['Sec-CH-Prefers-Color-Scheme'], 'dark');
  assert.equal(send({ ...page(url), webContents: 'other-tab', requestHeaders: {} }).requestHeaders['Sec-CH-Prefers-Color-Scheme'], 'light');
  assert.deepEqual(asked, ['dark-tab', 'other-tab']);
});
