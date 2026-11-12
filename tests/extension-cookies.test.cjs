'use strict';
// 13.7 Raindrop ("Please log in to start!" while signed in on the site): the engine blocks third-party cookies for an extension's own
// requests too, Chrome does not. browser-services/extension-cookies.cjs puts the cookies back on an extension's credentialed requests
// with Chrome's limits. These tests pin those limits (what is added, what never is) and the wiring through the real request pipeline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {RequestPipeline} = require('../desktop/request-pipeline.cjs');
const {createPermissionTable} = require('../desktop/browser-services/extension-permission-table.cjs');
const cookies = require('../desktop/browser-services/extension-cookies.cjs');

const NO = 'a'.repeat(32), HOST = 'b'.repeat(32), GONE = 'c'.repeat(32);
const URL = 'https://api.example.test/v1/user';
const jar = [
  {name: 'sess_none', value: '1', sameSite: 'no_restriction', secure: true},
  {name: 'sess_lax', value: '2', sameSite: 'lax', secure: true},
  {name: 'sess_strict', value: '3', sameSite: 'strict', secure: false},
  {name: 'sess_plain', value: '4', sameSite: 'unspecified', secure: false},
  {name: 'none_insecure', value: '5', sameSite: 'no_restriction', secure: false}
];

function world({jarCookies = jar, hostOrigins = ['https://api.example.test/*'], tor = false, failJar = false} = {}) {
  const manifests = {
    [NO]: {manifest_version: 3, name: 'No host', version: '1', permissions: ['storage']},
    [HOST]: {manifest_version: 3, name: 'Host', version: '1', permissions: ['storage'], host_permissions: hostOrigins}
  };
  const extensions = new Map(Object.entries(manifests).map(([id, manifest]) => [id, {id, manifest}]));
  const lookups = [];
  const session = {
    extensions: {getExtension: id => extensions.get(id) || null},
    cookies: {get: async query => {lookups.push(query); if (failJar) throw new Error('jar failed'); return jarCookies;}}
  };
  if (tor) session.__aciraTor = true;
  const table = createPermissionTable({userData: fs.mkdtempSync(path.join(os.tmpdir(), 'acira-extck-')), getExtension: id => extensions.get(id) || null});
  cookies.rememberPermissionTable(session, table);
  return {session, lookups, participant: cookies.createExtensionCookies(session)};
}
const request = (id, extra = {}) => ({
  id: 1, url: URL, method: 'GET', resourceType: 'xhr', initiatorOrigin: 'chrome-extension://' + id,
  requestHeaders: {Accept: '*/*', Origin: 'chrome-extension://' + id, 'Sec-Fetch-Storage-Access': 'none'}, ...extra
});
const sent = async (w, details) => {
  const patch = await w.participant(details);
  return patch && patch.requestHeaders ? patch.requestHeaders.Cookie : undefined;
};

test('an extension without host permission gets only the SameSite=None; Secure cookie (Raindrop)', async () => {
  const w = world();
  assert.equal(await sent(w, request(NO)), 'sess_none=1');
  assert.deepEqual(w.lookups, [{url: URL}], 'the lookup is for this request\'s own address, so another site\'s cookies are never read');
});

test('an extension with host permission for the address gets every matching cookie', async () => {
  const w = world();
  assert.equal(await sent(w, request(HOST)), 'sess_none=1; sess_lax=2; sess_strict=3; sess_plain=4; none_insecure=5');
});

test('host permission is per address: another host is treated as having none', async () => {
  const w = world({hostOrigins: ['https://elsewhere.test/*']});
  assert.equal(await sent(w, request(HOST)), 'sess_none=1');
});

test('credentials omitted or the same-origin default (no Sec-Fetch-Storage-Access) gets nothing, and the jar is not even read', async () => {
  const w = world();
  for (const id of [NO, HOST]) {
    const details = request(id);
    delete details.requestHeaders['Sec-Fetch-Storage-Access'];
    assert.deepEqual(await w.participant(details), {});
  }
  assert.deepEqual(w.lookups, []);
});

test('the header is matched whatever its case, and a present header with any value counts as credentials', async () => {
  const w = world();
  const details = request(NO);
  delete details.requestHeaders['Sec-Fetch-Storage-Access'];
  details.requestHeaders['sec-fetch-storage-access'] = 'inactive';
  assert.equal(await sent(w, details), 'sess_none=1');
});

test('requests that do not come from an installed, enabled extension are left alone and cost no lookup', async () => {
  const w = world();
  const cases = [
    request(NO, {initiatorOrigin: 'https://evil.example.test'}),          // a web page
    request(NO, {initiatorOrigin: undefined}),                           // no initiator (the browser itself)
    request(NO, {initiatorOrigin: 'null'}),
    request(NO, {initiatorOrigin: 'chrome-extension://' + NO + '.evil.test'}),
    request(NO, {initiatorOrigin: 'chrome-extension://short'}),
    request(GONE),                                                         // not installed / disabled (not loaded)
    request(NO, {url: 'wss://api.example.test/socket'}),
    request(NO, {url: 'file:///etc/hosts'}),
    request(NO, {resourceType: 'mainFrame'}),                              // navigations are never touched
    request(NO, {resourceType: 'subFrame'})
  ];
  for (const details of cases) assert.deepEqual(await w.participant(details), {}, JSON.stringify(details.initiatorOrigin) + ' ' + details.url + ' ' + details.resourceType);
  assert.deepEqual(w.lookups, []);
});

test('a Tor session and a session without the permission table get nothing', async () => {
  const tor = world({tor: true});
  assert.deepEqual(await tor.participant(request(HOST)), {});
  const symbolTor = world();
  symbolTor.session[Symbol.for('acira.tor.session')] = true;
  assert.deepEqual(await symbolTor.participant(request(HOST)), {});
  const bare = world();
  delete bare.session[cookies.TABLE];
  assert.deepEqual(await bare.participant(request(HOST)), {});
  assert.deepEqual([...tor.lookups, ...symbolTor.lookups, ...bare.lookups], []);
});

test('an existing Cookie header is kept and the cookies are merged without duplicates', async () => {
  const w = world();
  const details = request(HOST);
  details.requestHeaders.cookie = 'sess_lax=2; sess_strict=3; sess_plain=4';
  const patch = await w.participant(details);
  assert.deepEqual(Object.keys(patch.requestHeaders).filter(key => key.toLowerCase() === 'cookie'), ['cookie'], 'one Cookie header, under the name it already had');
  assert.equal(patch.requestHeaders.cookie, 'sess_lax=2; sess_strict=3; sess_plain=4; sess_none=1; none_insecure=5');
  const already = request(NO);
  already.requestHeaders.Cookie = 'sess_none=1';
  assert.deepEqual(await w.participant(already), {}, 'the engine already sent it (third-party cookies allowed): nothing doubled');
});

test('a failing or throwing jar returns {} (the pipeline would cancel the request on an error)', async () => {
  assert.deepEqual(await world({failJar: true}).participant(request(NO)), {});
  const w = world();
  w.session.cookies.get = () => {throw new Error('sync failure');};
  assert.deepEqual(await w.participant(request(NO)), {});
  assert.deepEqual(w.participant(null), {});
  assert.deepEqual(w.participant({}), {});
  const odd = world({jarCookies: [null, {name: 'a'}, {value: 'x'}, {name: '', value: 'bare', sameSite: 'no_restriction', secure: true}]});
  assert.equal(await sent(odd, request(NO)), 'bare');
});

test('through the real request pipeline: only an extension\'s credentialed request changes, every other request is returned untouched', async () => {
  const events = {};
  const webRequest = {
    onBeforeRequest: (_f, h) => {events.before = h;}, onHeadersReceived: (_f, h) => {events.headers = h;},
    onBeforeSendHeaders: (_f, h) => {events.send = h;}, onCompleted: () => {}, onErrorOccurred: () => {}
  };
  const w = world();
  const session = Object.assign(w.session, {webRequest});
  const pipeline = new RequestPipeline(session);
  pipeline.useSendHeaders(cookies.createExtensionCookies(session));
  const run = details => new Promise(resolve => events.send(details, resolve));
  const ext = await run(request(NO));
  assert.equal(ext.requestHeaders.Cookie, 'sess_none=1');
  assert.equal(ext.requestHeaders.Accept, '*/*', 'the other headers stay');
  const page = {id: 2, url: URL, method: 'GET', resourceType: 'xhr', webContentsId: 5, initiatorOrigin: 'https://app.example.test', requestHeaders: {Accept: '*/*', 'Sec-Fetch-Storage-Access': 'none'}};
  assert.deepEqual(await run(page), {}, 'a web page\'s third-party request is not given cookies: blocking stays');
  assert.equal(w.lookups.length, 1);
});

test('the wiring: every session\'s pipeline gets the participant, and the extension runtime shares its permission table with it', () => {
  const root = path.join(__dirname, '..', 'desktop');
  const blocking = fs.readFileSync(path.join(root, 'content-blocking.cjs'), 'utf8');
  assert.match(blocking, /pipeline\.useSendHeaders\(createExtensionCookies\(session\)\)/);
  const apis = fs.readFileSync(path.join(root, 'browser-services', 'extension-apis.cjs'), 'utf8');
  assert.match(apis, /rememberPermissionTable\(session,permissions\)/);
});
