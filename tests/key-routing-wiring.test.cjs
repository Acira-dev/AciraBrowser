'use strict';
// 13.8: the page side and the main-process side of Chromium's keyboard routing (desktop/key-routing.cjs): the page preload's answer for a keydown, and
// the places main.cjs uses the router. The live cases (a page that handles Cmd/Ctrl+K, a real editor, tab numbers, Focus view, windows) are rig runs; see the report.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const preload = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'page-input-preload.cjs'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');

const blockOf = () => {
  const start = preload.indexOf('try{\n // The next task');
  const tail = '/* no acknowledgement from this frame (no MessageChannel, no window): the main process keeps the key itself */}';
  const end = preload.indexOf(tail, start);
  assert.ok(start > 0 && end > start, 'the acknowledgement block is in the preload');
  return preload.slice(start, end + tail.length);
};

/** The acknowledgement block at the end of the preload, run against a fake window. */
function load() {
  const block = blockOf();
  const sent = [], listeners = [];
  const context = {
    require: name => (name === 'electron' ? {ipcRenderer: {send: (...args) => sent.push(args)}} : {}),
    window: {addEventListener: (type, fn, capture) => listeners.push({type, fn, capture})},
    // A message to oneself is a task of its own: the fake delivers it one task later, like the real one, with no handle left open.
    MessageChannel: class { constructor() { const self = this; this.port1 = {set onmessage(fn) { self.handler = fn; }}; this.port2 = {postMessage() { setTimeout(() => self.handler && self.handler({}), 0); }}; } }
  };
  vm.runInNewContext('const {ipcRenderer}=require("electron");' + block, context);
  return {sent, listeners};
}
const keydown = (extra = {}) => ({isTrusted: true, isComposing: false, key: 'k', code: 'KeyK', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, ...extra});
const settle = () => new Promise(resolve => setTimeout(resolve, 25));

test('the preload says it is ready, once, and listens for keydown first (capture phase) so no page script can stop the event before it is seen', () => {
  const {sent, listeners} = load();
  assert.deepEqual(sent, [['acira:key-ack-ready']]);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, 'keydown');
  assert.equal(listeners[0].capture, true);
});

test('a keydown the page does not consume is answered prevented:false, one it consumes (preventDefault in any listener of the same dispatch) prevented:true', async () => {
  const {sent, listeners} = load();
  sent.length = 0;
  const free = keydown(), eaten = keydown({key: 'e', code: 'KeyE'});
  listeners[0].fn(free); listeners[0].fn(eaten);
  eaten.defaultPrevented = true; // the page's own listener ran later in the same dispatch
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [
    ['acira:key-ack', {key: 'k', code: 'KeyK', ctrl: true, alt: false, shift: false, meta: false, repeat: false, prevented: false}],
    ['acira:key-ack', {key: 'e', code: 'KeyE', ctrl: true, alt: false, shift: false, meta: false, repeat: false, prevented: true}]
  ]);
});

test('typing is never answered (no modifier, a one-character key); function keys, Escape and any chord with a modifier are; untrusted and composing events never are', async () => {
  const {sent, listeners} = load();
  sent.length = 0;
  for (const event of [keydown({key: 'a', code: 'KeyA', ctrlKey: false}), keydown({key: 'A', code: 'KeyA', ctrlKey: false, shiftKey: true}), keydown({isTrusted: false}), keydown({isComposing: true})]) listeners[0].fn(event);
  await settle();
  assert.deepEqual(sent, []);
  for (const event of [keydown({key: 'F5', code: 'F5', ctrlKey: false}), keydown({key: 'Escape', code: 'Escape', ctrlKey: false}), keydown({key: 'd', code: 'KeyD', ctrlKey: false, altKey: true}), keydown({key: 'k', code: 'KeyK', ctrlKey: false, metaKey: true}), keydown({repeat: true})]) listeners[0].fn(event);
  await settle();
  assert.equal(sent.length, 5);
  assert.equal(sent[4][1].repeat, true);
});

test('main.cjs: a key typed into a page that the browser does not reserve is held for the page\'s answer, the answer runs it, and a new document drops what was waiting', () => {
  assert.match(main, /const keyRouting=require\('\.\/key-routing\.cjs'\),keyAck=keyRouting\.createAckRouter\(\)/);
  assert.match(main, /function shortcut\(wc,event,input,menuCommand,origin=menuCommand\?'menu':'key',replay=null\)/);
  assert.match(main, /const noted=replay\?replay\.noted:/, 'a replayed key does not feed the tab numbers a second time');
  assert.match(main, /keyRouting\.preHandleKeyboardEvent\(\{input,command,fullscreen:mainWindow\.isFullScreen\(\),ready:keyAck\.canAcknowledge\(wc,frameKey\)\}\)===keyRouting\.RESULT\.NOT_HANDLED_IS_SHORTCUT/);
  assert.match(main, /keyAck\.defer\(wc,input,\(\)=>\{[^}]*shortcut\(wc,\{preventDefault\(\)\{\}\},input,undefined,'key',\{noted\}\)/);
  assert.match(main, /pageBridge\.on\('acira:key-ack-ready'/);
  assert.match(main, /pageBridge\.on\('acira:key-ack',\(event,payload\)=>/);
  assert.match(main, /did-start-navigation',event=>\{if\(event\.isMainFrame&&!event\.isSameDocument\)\{closePageMenuOf\(wc\);keyAck\.abandon\(wc\);keyAck\.forgetFrames\(wc\)/);
  assert.match(main, /noted===undefined&&!trustedContents\.has\(wc\)/, 'only a key typed into a page, and not one the tab numbers hold');
  assert.match(main, /matchesMenuAccelerator\(macMenuKeys,input,shortcutKey\)/, 'macOS: the menu\'s own keys stay the browser\'s first');
});

test('without a MessageChannel or a window the block does nothing at all: no listener, no ready message, so the main process keeps the key itself', () => {
  const sent = [], listeners = [];
  vm.runInNewContext('const {ipcRenderer}=require("electron");' + blockOf(), {require: () => ({ipcRenderer: {send: (...args) => sent.push(args)}}), window: {addEventListener: (...args) => listeners.push(args)}});
  assert.deepEqual(sent, []);
  assert.deepEqual(listeners, []);
});
