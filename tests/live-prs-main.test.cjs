'use strict';
// Live pull requests (item 31): the main-process glue. Which windows may have the folder, how a request reaches the service, which source a profile gets,
// and that nothing about it runs until the folder is added.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const fresh = () => { for (const name of ['handle.cjs', 'service.cjs']) delete require.cache[require.resolve('../desktop/live-prs/' + name)]; return require('../desktop/live-prs/handle.cjs'); };
const profile = (extra = {}) => ({ id: 'p1', name: 'Personal', partition: 'persist:p1', ...extra });
const snapshot = (extra = {}) => ({ browserProfiles: [profile(extra.profile)], activeBrowserProfileId: 'p1', workspaces: [{ id: 'w1', ...(extra.workspace || {}) }], activeWorkspaceId: 'w1' });
const until = async (check) => { for (let i = 0; i < 150; i++) { if (check()) return true; await new Promise((resolve) => setTimeout(resolve, 20)); } return check(); };
const listener = () => ({ emit() {}, alive: () => true, visible: () => true });

test('only ordinary windows of ordinary profiles can have the folder: not private, not Tor, not a secured workspace', () => {
  const { supportedHere } = fresh();
  assert.equal(supportedHere({ state: snapshot(), privateMode: false, torMode: false }).id, 'p1');
  assert.equal(supportedHere({ state: snapshot(), privateMode: true, torMode: false }), null);
  assert.equal(supportedHere({ state: snapshot(), privateMode: false, torMode: true }), null);
  assert.equal(supportedHere({ state: snapshot({ profile: { private: true } }), privateMode: false, torMode: false }), null);
  assert.equal(supportedHere({ state: snapshot({ profile: { tor: true } }), privateMode: false, torMode: false }), null);
  assert.equal(supportedHere({ state: snapshot({ workspace: { secured: true } }), privateMode: false, torMode: false }), null);
  assert.equal(supportedHere({ state: { ...snapshot(), activeBrowserProfileId: 'gone' }, privateMode: false, torMode: false }), null);
});

test('the seven requests reach the service with the profile\'s own id, name and partition (never the window\'s secrets), and answer under `livePrs`', () => {
  const { handle } = fresh(), calls = [];
  const service = new Proxy({}, { get: (_t, name) => (...args) => { calls.push([name, ...args.map((arg) => (arg && arg.emit ? 'listener' : arg))]); return { name }; } });
  const context = { service, state: snapshot(), privateMode: false, torMode: false, listener: listener() };
  assert.deepEqual(handle({ type: 'live-prs.status' }, context), { livePrs: { name: 'watch' } });
  handle({ type: 'live-prs.add' }, context); handle({ type: 'live-prs.remove' }, context); handle({ type: 'live-prs.refresh' }, context);
  handle({ type: 'live-prs.filters', patch: { drafts: false } }, context); handle({ type: 'live-prs.rename', name: 'Reviews' }, context); handle({ type: 'live-prs.hide', id: 'a/b#1' }, context);
  const own = { id: 'p1', name: 'Personal', partition: 'persist:p1' };
  assert.deepEqual(calls, [['watch', own, 'listener'], ['add', own, 'listener'], ['remove', own], ['refresh', own], ['setFilters', own, { drafts: false }], ['rename', own, 'Reviews'], ['hide', own, 'a/b#1']]);
  assert.throws(() => handle({ type: 'live-prs.bogus' }, context), /Unknown/);
});

test('a window that cannot have the folder is told so on status and remove, and refused everything that would make one', () => {
  const { handle } = fresh(), calls = [];
  const service = new Proxy({}, { get: (_t, name) => (...args) => { calls.push(name); return {}; } });
  const context = { service, state: snapshot(), privateMode: true, torMode: false, listener: listener() };
  assert.deepEqual(handle({ type: 'live-prs.status' }, context), { livePrs: { supported: false, folder: null } });
  assert.deepEqual(handle({ type: 'live-prs.remove' }, context), { livePrs: { supported: false, folder: null } });
  for (const type of ['live-prs.add', 'live-prs.filters', 'live-prs.rename', 'live-prs.hide', 'live-prs.refresh']) assert.throws(() => handle({ type }, context), /ordinary windows/, type);
  assert.deepEqual(calls, [], 'the service was never touched');
});

test('the source: the real one goes through the profile\'s own session; the mock only on a test profile with the test hook, and the real one otherwise', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-live-prs-main-'));
  try {
    const sessions = [];
    const session = { fromPartition: (partition) => { const ses = { partition, fetched: [], cookies: { on(name, fn) { ses.cookieListener = fn; } }, fetch: async (url, init) => { ses.fetched.push([url, init]); return { status: 200, headers: { forEach() {} }, text: async () => JSON.stringify({ payload: { blackbirdSearchRoute: { logged_in: true, results: [], page_count: 1, errors: [] } } }) }; } }; sessions.push(ses); return ses; } };
    const real = fresh().livePrsService({ directory: dir, session, env: { ACIRA_TEST_LIVE_PRS: 'mock' } });
    real.add(profile(), listener()); await until(() => real.status(profile()).phase === 'ok');
    assert.equal(sessions.length, 1, 'no test profile: the hook is ignored and the profile\'s own session is used');
    assert.equal(sessions[0].partition, 'persist:p1'); assert.ok(sessions[0].fetched.length >= 1);
    assert.equal(new URL(sessions[0].fetched[0][0]).origin, 'https://github.com'); assert.equal(sessions[0].fetched[0][1].credentials, 'include');
    real.shutdown();
    const mock = fresh().livePrsService({ directory: dir, session, env: { ACIRA_TEST_LIVE_PRS: 'mock', ACIRA_BROWSER_TEST_DATA: dir } });
    sessions.length = 0;
    mock.watch(profile(), listener()); await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sessions.length, 0, 'test profile with the hook: made-up pull requests, no session touched');
    assert.ok(mock.status(profile()).rows.length > 0 && mock.status(profile()).source === 'mock');
    mock.shutdown();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('signing in to github.com in the profile (its sign-in cookie appears) wakes a folder that was waiting signed out; a removed cookie or another site does not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-live-prs-main-'));
  try {
    let signedIn = false, ses;
    const session = { fromPartition: () => ses ??= { cookies: { on(name, fn) { assert.equal(name, 'changed'); ses.listener = fn; } }, fetch: async () => ({ status: 200, headers: { forEach() {} }, text: async () => JSON.stringify({ payload: { blackbirdSearchRoute: { logged_in: signedIn, results: [], page_count: 1, errors: [] } } }) }) } };
    const service = fresh().livePrsService({ directory: dir, session, env: {} });
    service.add(profile(), listener()); await until(() => service.status(profile()).phase === 'signed-out');
    assert.equal(service.status(profile()).phase, 'signed-out');
    signedIn = true;
    ses.listener({}, { name: 'logged_in', domain: '.github.com' }, 'explicit', true);   // removed
    ses.listener({}, { name: 'logged_in', domain: '.example.com' }, 'explicit', false); // another site
    ses.listener({}, { name: 'other', domain: '.github.com' }, 'explicit', false);      // another cookie
    await new Promise((resolve) => setTimeout(resolve, 100)); assert.equal(service.status(profile()).phase, 'signed-out');
    ses.listener({}, { name: 'logged_in', domain: '.github.com' }, 'explicit', false);
    await until(() => service.status(profile()).phase === 'ok'); assert.equal(service.status(profile()).phase, 'ok');
    service.shutdown();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('main.cjs: the requests are served, a window is a listener and tells the folder when it shows, and a github.com pull request page finishing loading is noted; it is a test hook', () => {
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  assert.match(main, /case 'live-prs\.status':case 'live-prs\.add':case 'live-prs\.remove':case 'live-prs\.filters':case 'live-prs\.rename':case 'live-prs\.hide':case 'live-prs\.refresh':\{shape\(\['patch','name','id'\]\)/);
  assert.match(main, /function record\(event\)\{livePrsPageLoaded\(event\);/);
  assert.match(main, /for\(const name of \['show','restore','focus'\]\)mainWindow\.on\(name,livePrsVisible\);/);
  assert.match(main, /const livePrsListener=\(\)=>livePrsWindowListener\?\?=\{emit:emitBrowser,/);
  assert.ok(require('../desktop/test-hooks.cjs').HOOK_ENV.includes('ACIRA_TEST_LIVE_PRS'), 'dropped in a real run on the person\'s own profile');
  assert.match(fs.readFileSync(path.join(__dirname, '../docs/launch/TEST_HOOKS.md'), 'utf8'), /ACIRA_TEST_LIVE_PRS/);
});

test('nothing runs before the folder is added: asking for the status builds no source, makes no request and writes no file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-live-prs-main-'));
  try {
    let touched = 0;
    const session = { fromPartition: () => { touched += 1; return { cookies: { on() {} }, fetch: async () => { touched += 1; throw new Error('no'); } }; } };
    const service = fresh().livePrsService({ directory: dir, session, env: {} });
    for (let i = 0; i < 3; i++) assert.equal(service.watch(profile(), listener()).folder, null);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(touched, 0); assert.deepEqual(fs.readdirSync(dir), []);
    service.shutdown();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the trace file: only on a test profile, only a file inside it, one line per answer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-live-prs-trace-'));
  try {
    const session = { fromPartition: () => ({ cookies: { on() {} }, fetch: async () => ({ status: 200, headers: { forEach() {} }, text: async () => JSON.stringify({ payload: { blackbirdSearchRoute: { logged_in: true, results: [], page_count: 1, errors: [] } } }) }) }) };
    const trace = path.join(dir, 'trace.jsonl');
    const service = fresh().livePrsService({ directory: dir, session, env: { ACIRA_BROWSER_TEST_DATA: dir, ACIRA_TEST_LIVE_PRS_TRACE: trace } });
    service.add(profile(), listener()); await until(() => fs.existsSync(trace) && fs.readFileSync(trace, 'utf8').trim().split('\n').length >= 3);
    const lines = fs.readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => line.relation), ['author', 'review', 'assigned']); assert.ok(lines.every((line) => line.status === 200 && line.reading === 'ok'));
    service.shutdown();
    for (const env of [{ ACIRA_TEST_LIVE_PRS_TRACE: path.join(dir, 'x.jsonl') }, { ACIRA_BROWSER_TEST_DATA: dir, ACIRA_TEST_LIVE_PRS_TRACE: path.join(os.tmpdir(), 'elsewhere-' + process.pid + '.jsonl') }]) {
      const other = fresh().livePrsService({ directory: dir, session, env }); other.add(profile('p2'), listener()); await until(() => other.status(profile('p2')).phase === 'ok'); other.shutdown();
    }
    assert.equal(fs.existsSync(path.join(dir, 'x.jsonl')), false, 'not a test profile: no trace'); assert.equal(fs.existsSync(path.join(os.tmpdir(), 'elsewhere-' + process.pid + '.jsonl')), false, 'outside the profile: no trace');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
