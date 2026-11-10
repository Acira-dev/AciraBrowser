'use strict';
// One debugger per page, shared by leases (desktop/page-debugger.cjs): the first lease attaches, the last one detaches, a debugger somebody else attached is never touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {acquire, held} = require('../desktop/page-debugger.cjs');

function fakePage({attached = false} = {}) {
  const log = [], debug = new EventEmitter();
  debug.attached = attached;
  debug.isAttached = () => debug.attached;
  debug.attach = version => { if (debug.attached) throw new Error('Debugger is already attached'); debug.attached = true; log.push(['attach', version]); };
  debug.detach = () => { debug.attached = false; log.push(['detach']); debug.emit('detach', {}, 'target closed'); };
  debug.sendCommand = async (method, params, sessionId) => { if (!debug.attached) throw new Error('Debugger is not attached'); log.push(['send', method, params, sessionId]); return {}; };
  return {log, debug, wc: {debugger: debug, isDestroyed: () => false}};
}

test('the first lease attaches, commands pass through, the last release detaches', async () => {
  const {log, wc} = fakePage();
  const a = acquire(wc, 'one');
  assert.ok(a); assert.deepEqual(log, [['attach', '1.3']]);
  await a.sendCommand('Emulation.setPageScaleFactor', {pageScaleFactor: 2}, 'frame-1');
  assert.deepEqual(log.at(-1), ['send', 'Emulation.setPageScaleFactor', {pageScaleFactor: 2}, 'frame-1']);
  a.release();
  assert.deepEqual(log.at(-1), ['detach']); assert.equal(held(wc), 0);
});

test('a second feature shares the session: no second attach, and the first one letting go keeps the session for the other', async () => {
  const {log, debug, wc} = fakePage();
  const dark = acquire(wc, 'appearance'), zoom = acquire(wc, 'zoom-glide');
  assert.ok(dark && zoom); assert.equal(log.filter(entry => entry[0] === 'attach').length, 1); assert.equal(held(wc), 2);
  zoom.release();
  assert.equal(debug.attached, true, 'the zoom glide finishing does not end the page\'s colour overrides');
  await dark.sendCommand('Emulation.setAutoDarkModeOverride', {enabled: true});
  dark.release();
  assert.equal(debug.attached, false); assert.equal(held(wc), 0);
});

test('a debugger somebody else attached is not shared: null, nothing sent, nothing detached', () => {
  const {log, debug, wc} = fakePage({attached: true});
  assert.equal(acquire(wc, 'appearance'), null);
  assert.deepEqual(log, []); assert.equal(debug.attached, true);
});

test('release twice is harmless, and a lease cannot send once it is released', async () => {
  const {wc} = fakePage();
  const a = acquire(wc, 'one'), b = acquire(wc, 'two');
  a.release(); a.release();
  assert.equal(held(wc), 1, 'the second release of the same lease does not take the other one\'s share');
  await assert.rejects(a.sendCommand('Page.enable'), /ended/);
  await b.sendCommand('Page.enable'); b.release();
});

test('a session that ends under the leases (page crash, DevTools target closed) tells each of them once and a later acquire starts afresh', async () => {
  const {log, debug, wc} = fakePage();
  const told = [], a = acquire(wc, 'one').onDetach(() => told.push('one')), b = acquire(wc, 'two').onDetach(() => told.push('two'));
  debug.attached = false; debug.emit('detach', {}, 'target crashed');
  assert.deepEqual(told.sort(), ['one', 'two']); assert.equal(a.over && b.over, true); assert.equal(held(wc), 0);
  const c = acquire(wc, 'three'); assert.ok(c); assert.equal(log.filter(entry => entry[0] === 'attach').length, 2);
  a.release(); // an old lease letting go must not detach the new session
  assert.equal(debug.attached, true); c.release();
});

test('a destroyed page gives no lease', () => {
  const {wc} = fakePage(); wc.isDestroyed = () => true;
  assert.equal(acquire(wc, 'x'), null); assert.equal(acquire(null, 'x'), null);
});

test('no feature attaches a page\'s debugger on its own any more, except the ones that own a page nobody else uses (Tor, the hidden cookie and retirement pages)', () => {
  const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '../desktop'), found = [];
  const walk = dir => { for (const name of fs.readdirSync(dir, {withFileTypes: true})) { const full = path.join(dir, name.name); if (name.isDirectory()) walk(full); else if (/\.cjs$/.test(name.name) && /\.attach\('1\.3'\)/.test(fs.readFileSync(full, 'utf8'))) found.push(path.relative(root, full).replaceAll('\\', '/')); } };
  walk(root);
  assert.deepEqual(found.sort(), ['browser-services/private-session-retirement.cjs', 'browser-services/session-cookie-restore.cjs', 'browser-services/tor-window.cjs', 'page-debugger.cjs'], 'a new debugger user takes a lease (page-debugger.cjs) so a dark tab does not make it give up');
});

// 13.5: tab sleep asks "is somebody ELSE using this page's debugger?". Acira's own Website appearance session sits on every dark/light tab for as long as it lives and must not hold it awake.
const {inUseByOthers, PASSIVE} = require('../desktop/page-debugger.cjs');

test('inUseByOthers: no debugger attached, or only the Website appearance session (even with the page frozen by tab sleep gone again): nobody else', () => {
  const {wc, debug} = fakePage();
  assert.equal(inUseByOthers(wc), false, 'no debugger at all');
  const dark = acquire(wc, 'appearance');
  assert.equal(debug.attached, true); assert.equal(inUseByOthers(wc), false, 'Always dark / Light / Dark: our session, a passive lease');
  assert.deepEqual(PASSIVE, ['appearance']);
  dark.release(); assert.equal(debug.attached, false); assert.equal(inUseByOthers(wc), false);
});

test('inUseByOthers: any other lease, any debugger that is not ours, and anything that cannot be told, count as somebody else', () => {
  for (const owner of ['zoom-glide', 'secured', 'capture', 'sleep', 'something-new']) {
    const {wc} = fakePage(), dark = acquire(wc, 'appearance'), other = acquire(wc, owner);
    assert.equal(inUseByOthers(wc), true, `appearance + ${owner}`); other.release(); assert.equal(inUseByOthers(wc), false, `${owner} done`); dark.release();
    const alone = acquire(wc, owner); assert.equal(inUseByOthers(wc), true, `${owner} alone`); alone.release();
  }
  const foreign = fakePage({attached: true}); assert.equal(inUseByOthers(foreign.wc), true, 'Tor, a hidden cookie page, any other client');
  assert.equal(acquire(foreign.wc, 'appearance'), null); assert.equal(inUseByOthers(foreign.wc), true, 'and a refused lease does not make it ours');
  assert.equal(inUseByOthers({debugger: {isAttached() { throw new Error('Object has been destroyed'); }}}), true);
  assert.equal(inUseByOthers({}), true); assert.equal(inUseByOthers(null), true);
});

test('inUseByOthers: our session ends under the lease and somebody else attaches: that is somebody else, not the old passive lease', () => {
  const {wc, debug} = fakePage(); acquire(wc, 'appearance').onDetach(() => {});
  debug.attached = false; debug.emit('detach', {}, 'target crashed');          // our session is gone
  assert.equal(inUseByOthers(wc), false, 'nothing attached');
  debug.attached = true;                                                       // another client attached (no lease of ours)
  assert.equal(inUseByOthers(wc), true);
});

test('inUseByOthers: a named list can widen what does not count', () => {
  const {wc} = fakePage(), a = acquire(wc, 'appearance'), z = acquire(wc, 'zoom-glide');
  assert.equal(inUseByOthers(wc), true); assert.equal(inUseByOthers(wc, ['appearance', 'zoom-glide']), false); z.release(); a.release();
});
