'use strict';
// 13.5: the page-start preloads (chrome-identity, farbling, scriptlets, page-risk, autoconsent) ask the main process ONE synchronous question per frame instead of one each.
// Every blocked round trip delays the page's first script, in every iframe too (measured: about 6 ms per frame). The answers come from the very same handlers.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), {EventEmitter} = require('node:events');
const boot = require('../desktop/browser-services/frame-boot.cjs');
const root = path.join(__dirname, '..', 'desktop');
const src = file => fs.readFileSync(path.join(root, file), 'utf8');

/** A stand-in for ipcMain with the real shape that matters: on(), listeners(), and handlers that answer by setting event.returnValue. */
function bus(handlers) {
  const ipc = new EventEmitter(), calls = [];
  for (const [channel, fn] of Object.entries(handlers)) ipc.on(channel, function (event, ...args) { calls.push([channel, args, event.sender?.id, event.senderFrame?.url]); fn.call(this, event, ...args); });
  return {ipc, calls};
}
function ask(ipc, href, mainFrame, topFrame, frameUrl = href) {
  let answered, count = 0;
  const event = {sender: {id: 7}, senderFrame: {url: frameUrl}, set returnValue(value) { answered = value; count++; }};
  ipc.emit(boot.BOOT, event, href, mainFrame, topFrame);
  return {answers: answered, setCount: count};
}
const channels = Object.values(boot.CHANNELS);

test('which questions a frame asks: websites and srcdoc get identity and farbling, the main frame scriptlets, the top frame page-risk, websites autoconsent', () => {
  const names = (href, main, top) => boot.questionsFor(href, main, top).map(([channel]) => channel.replace('acira:', ''));
  assert.deepEqual(names('https://a.test/', true, true), ['chrome-identity', 'farbling', 'scriptlets', 'page-risk-config', 'autoconsent-setup']);
  assert.deepEqual(names('https://ads.test/x', false, false), ['chrome-identity', 'farbling', 'autoconsent-setup'], 'an iframe: no scriptlets, no page-risk');
  assert.deepEqual(names('about:srcdoc', false, false), ['chrome-identity', 'farbling'], 'a srcdoc frame is a website document for identity and farbling only');
  assert.deepEqual(names('about:blank', true, true), []);
  assert.deepEqual(names('acira://new', true, true), []);
  assert.deepEqual(names('file:///tmp/a.html', true, true), []);
  assert.deepEqual(boot.questionsFor('https://a.test/', true, true).find(([c]) => c === 'acira:autoconsent-setup')[1], [true], 'autoconsent is told whether this is the main frame, as before');
  assert.deepEqual(boot.questionsFor('https://a.test/p', true, true).find(([c]) => c === 'acira:farbling')[1], ['https://a.test/p']);
});

test('one boot question answers what the five handlers would have answered, each handler called once with the same event sender and frame', () => {
  const {ipc, calls} = bus({
    'acira:chrome-identity': e => { e.returnValue = 'identity-script'; },
    'acira:farbling': (e, href) => { e.returnValue = 'farble:' + href; },
    'acira:scriptlets': (e, href) => { e.returnValue = ['s1:' + href]; },
    'acira:page-risk-config': e => { e.returnValue = {enabled: true}; },
    'acira:page-risk-script': e => { e.returnValue = 'risk-script'; },
    'acira:autoconsent-setup': (e, main) => { e.returnValue = main ? {rules: 'r'} : null; },
  });
  boot.install(ipc);
  const {answers, setCount} = ask(ipc, 'https://a.test/p', true, true);
  assert.equal(setCount, 1, 'the real event is answered exactly once');
  assert.deepEqual(answers, {'acira:chrome-identity': 'identity-script', 'acira:farbling': 'farble:https://a.test/p', 'acira:scriptlets': ['s1:https://a.test/p'], 'acira:page-risk-config': {enabled: true}, 'acira:page-risk-script': 'risk-script', 'acira:autoconsent-setup': {rules: 'r'}});
  assert.equal(calls.length, 6);
  for (const call of calls) { assert.equal(call[2], 7, 'the handler sees the asking page as event.sender'); assert.equal(call[3], 'https://a.test/p', 'and the asking frame as event.senderFrame'); }
  assert.deepEqual(new Set(calls.map(c => c[0])), new Set(channels));
});

test('an iframe is asked only for what its preloads ask; the page-risk script only when page-risk is on; unanswered, throwing and doubly-registered handlers fall back to the old question', () => {
  const {ipc, calls} = bus({
    'acira:chrome-identity': e => { e.returnValue = ''; },
    'acira:farbling': () => { /* gives no answer */ },
    'acira:scriptlets': () => { throw new Error('boom'); },
    'acira:page-risk-config': e => { e.returnValue = {enabled: false}; },
    'acira:page-risk-script': e => { e.returnValue = 'must not be asked'; },
    'acira:autoconsent-setup': e => { e.returnValue = null; },
  });
  boot.install(ipc);
  const frame = ask(ipc, 'https://ads.test/', false, false).answers;
  assert.deepEqual(frame, {'acira:chrome-identity': '', 'acira:autoconsent-setup': null}, 'an empty string and null are answers; "no answer" is not');
  assert.ok(!calls.some(c => c[0] === 'acira:scriptlets' || c[0] === 'acira:page-risk-config'), 'an iframe never asks scriptlets or page-risk');
  const top = ask(ipc, 'https://a.test/', true, true).answers;
  assert.equal(top['acira:scriptlets'], undefined, 'a handler that throws: the preload asks it itself');
  assert.equal(top['acira:farbling'], undefined, 'a handler that gives no answer: the preload asks it itself');
  assert.deepEqual(top['acira:page-risk-config'], {enabled: false});
  assert.ok(!('acira:page-risk-script' in top) && !calls.some(c => c[0] === 'acira:page-risk-script'), 'the page-risk script is only fetched when page-risk is enabled');
  ipc.on('acira:chrome-identity', e => { e.returnValue = 'second'; });
  assert.ok(!('acira:chrome-identity' in ask(ipc, 'https://a.test/', true, true).answers), 'two handlers for one question: left to the preload');
});

test('a boot question that is malformed or fails still gets an answer, never none', () => {
  const {ipc} = bus({'acira:chrome-identity': e => { e.returnValue = 'x'; }});
  boot.install(ipc);
  assert.deepEqual(ask(ipc, 12345, true, true).answers, {});
  assert.deepEqual(ask(ipc, 'https://a.test/' + 'x'.repeat(9000), true, true).answers, {}, 'an absurd address is not worth answering');
  assert.deepEqual(ask(ipc, 'https://a.test/', 'yes', 1).answers, {'acira:chrome-identity': 'x'}, 'flags that are not booleans count as false');
});

test('the five preloads ask through one identical client with the old question as fallback, and main installs the boot handler', () => {
  const folded = ['chrome-identity-preload.cjs', 'farbling-preload.cjs', 'page-risk-preload.cjs', 'scriptlet-preload.cjs', 'autoconsent-preload-entry.cjs'];
  for (const file of folded) {
    const text = src('browser-services/' + file), match = /\/\* frame-boot client \(frame-boot\.cjs\) \*\/(.*)\/\* end frame-boot client \*\//.exec(text);
    assert.ok(match, file + ' carries the client');
    assert.equal(match[1], boot.CLIENT, file + ' carries the same client text');
    const outside = text.replace(match[0], '');
    assert.doesNotMatch(outside, /ipcRenderer\.sendSync\('acira:(chrome-identity|farbling|scriptlets|page-risk-config|page-risk-script|autoconsent-setup)'/, file + ' no longer asks its question by itself');
    assert.match(outside, /bootAnswer\('acira:/, file + ' asks through the client');
  }
  assert.match(boot.CLIENT, /return ipcRenderer\.sendSync\(channel,\.\.\.args\);\};$/, 'the old question is the fallback');
  assert.match(src('main.cjs'), /require\('\.\/browser-services\/frame-boot\.cjs'\)\.install\(ipcMain\)/);
  assert.match(src('browser-services/scriptlet-preload.cjs'), /ipcRenderer\.sendSync\('acira:ad-slot-styles'/, 'the weather.com ad-slot question stays a direct one (one site)');
});
