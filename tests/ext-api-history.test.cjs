'use strict';
// chrome.history.onVisited / onVisitRemoved (package P7): what the shared history list reports, scoped to the extension's own profile,
// and the path from there to an extension (Vimium keeps its history cache current with these two events).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const {installExtensionApis} = require('../desktop/browser-services/extension-apis.cjs');
const hook = require('../desktop/browser-services/ext-api/history/host.cjs');
const {extensionWorld, plain, ID} = require('./fixtures/ext-api/world.cjs');

const visit = (n, url, patch = {}) => ({id: `v${n}`, title: `Title ${n}`, url, time: new Date(Date.UTC(2026, 9, 28, 10, 0, n)).toISOString(), profileId: 'p', browserProfileId: 'profile-personal', ...patch});
const collect = () => { const events = []; const off = hook.on(event => events.push(event)); return {events, off}; };

test('the first list only teaches; later lists report new visits (with the visit count) and removals (only when the page is gone)', () => {
  hook.reset();
  const {events, off} = collect();
  try {
    const a = visit(1, 'https://a.example/'), b = visit(2, 'https://b.example/');
    hook.noteHistory([b, a]);
    assert.deepEqual(events, [], 'the list at start-up is not news');
    hook.noteHistory([b, a]);
    const same = [b, a];
    hook.noteHistory(same); hook.noteHistory(same);
    assert.deepEqual(events, []);
    const again = visit(3, 'https://a.example/');
    hook.noteHistory([again, b, a]);
    assert.equal(events.length, 1);
    assert.deepEqual(plain(events[0]), {type: 'visited', profileId: 'profile-personal', item: {id: 'v3', url: 'https://a.example/', title: 'Title 3', lastVisitTime: Date.UTC(2026, 9, 28, 10, 0, 3), visitCount: 2, typedCount: 0}});
    events.length = 0;
    hook.noteHistory([again, b]);   // one of a's two visits went: the page is still in history
    assert.deepEqual(events, []);
    hook.noteHistory([b]);          // the last visit of a.example went
    assert.deepEqual(plain(events), [{type: 'removed', profileId: 'profile-personal', removed: {allHistory: false, urls: ['https://a.example/']}}]);
    events.length = 0;
    hook.noteHistory([]);
    assert.deepEqual(plain(events), [{type: 'removed', profileId: 'profile-personal', removed: {allHistory: true}}], 'clearing everything is allHistory');
  } finally { off(); hook.reset(); }
});

test('profiles are reported separately', () => {
  hook.reset();
  const {events, off} = collect();
  try {
    const mine = visit(1, 'https://a.example/'), work = visit(2, 'https://w.example/', {browserProfileId: 'profile-work'});
    hook.noteHistory([mine, work]);
    hook.noteHistory([mine]);
    assert.deepEqual(plain(events), [{type: 'removed', profileId: 'profile-work', removed: {allHistory: true}}]);
    events.length = 0;
    hook.noteHistory([mine, visit(4, 'https://x.example/', {browserProfileId: 'profile-work'})]);
    assert.deepEqual(events.map(e => [e.type, e.profileId, e.item.url]), [['visited', 'profile-work', 'https://x.example/']]);
  } finally { off(); hook.reset(); }
});

function rig() {
  const handlers = new Map(), sent = [], listening = new Map();
  const router = {handlers, listeners: listening, handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent: (id, name, ...args) => sent.push([id, name, ...args]), broadcastEvent: (name, ...args) => sent.push(['*', name, ...args])};
  const session = {extensions: {getExtension: () => null, on() {}}, serviceWorkers: {getAllRunning: () => ({})}};
  const apis = installExtensionApis({ctx: {router}}, {session, userData: os.tmpdir(), storeKey: 'profile-personal', extApiDir: path.join(__dirname, '..', 'desktop', 'browser-services', 'ext-api')});
  return {sent, listening, apis};
}

test('events reach listening extensions of that profile only; nobody listening, no work', () => {
  hook.reset();
  const r = rig();
  try {
    hook.noteHistory([visit(1, 'https://a.example/')]);
    hook.noteHistory([visit(2, 'https://b.example/'), visit(1, 'https://a.example/')]);
    assert.deepEqual(r.sent, [], 'no listener');
    r.listening.set('history.onVisited', [{extensionId: ID}]); r.listening.set('history.onVisitRemoved', [{extensionId: ID}]);
    hook.noteHistory([visit(3, 'https://c.example/'), visit(2, 'https://b.example/'), visit(1, 'https://a.example/')]);
    hook.noteHistory([visit(3, 'https://c.example/', {browserProfileId: 'profile-work'})]);
    assert.deepEqual(r.sent.map(entry => [entry[0], entry[1], entry[2].url || entry[2]]).slice(0, 1), [['*', 'history.onVisited', 'https://c.example/']]);
    assert.equal(r.sent.some(entry => entry[1] === 'history.onVisitRemoved'), true, 'this profile\'s pages were removed');
    assert.equal(r.sent.filter(entry => entry[1] === 'history.onVisited').length, 1, 'a visit of the work profile is not sent to the personal profile\'s extensions');
  } finally { r.apis.dispose?.(); hook.reset(); }
});

test('renderer: chrome.history keeps the older answers and gets real events', () => {
  const packages = extApi.loadPackages({fresh: true}).filter(pkg => pkg.name === 'history');
  const world = extensionWorld({manifest_version: 3, permissions: ['history']}, {packages, browser: {runtime: {id: ID}}, native: {history: {search: () => 'older answer', getVisits: () => 'older visits'}}});
  const seen = [], gone = [];
  assert.equal(world.chrome.history.search(), 'older answer', 'the older search answer is still there');
  world.chrome.history.onVisited.addListener(item => seen.push(item.url));
  world.chrome.history.onVisitRemoved.addListener(info => gone.push(info));
  world.emit('history.onVisited', {id: '1', url: 'https://a.example/', title: 'A', lastVisitTime: 1, visitCount: 1, typedCount: 0});
  world.emit('history.onVisitRemoved', {allHistory: true});
  assert.deepEqual(seen, ['https://a.example/']);
  assert.deepEqual(plain(gone), [{allHistory: true}]);
  assert.equal(world.browser.history, world.chrome.history);
  const without = extensionWorld({manifest_version: 3, permissions: []}, {packages, native: {history: {search: () => 1}}});
  assert.equal(without.chrome.history, undefined, 'no history permission, no chrome.history');
});
