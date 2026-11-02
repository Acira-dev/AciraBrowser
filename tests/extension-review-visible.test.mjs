// A visible extension-matrix run (D_VISIBLE=1) asks the install review with Acira's own question window (public/native-dialog.*),
// not the system message box the harness stubs. Before qa/extension-matrix/lib.mjs answered that window, a visible run waited on
// the review forever and the outer timeout's kill showed up as "Target crashed" on the UI page (reported as a renderer crash).
// This runs the real dialog page script in a small fake DOM and checks the harness answers it once per question, by clicking the
// button a person would, and records it like the stubbed system dialog.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {answerAppDialogs} from '../qa/extension-matrix/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageScript = fs.readFileSync(path.join(root, 'public/native-dialog.js'), 'utf8');

class FakeElement {
  constructor(tag, id = '') { this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; this.hidden = false; this.type = ''; this.className = ''; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  toggleAttribute(name, on) { if (on) this.attributes[name] = ''; else delete this.attributes[name]; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  click() { for (const listener of this.listeners.click || []) listener({type: 'click'}); }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return {height: 240}; }
  get firstElementChild() { return this.children[0] || null; }
  *descendants() { for (const child of this.children) { yield child; yield* child.descendants(); } }
  // Enough of querySelector for '[data-index="N"]' and '#actions button[data-index="N"]'.
  querySelector(selector) {
    const match = /^(?:#([\w-]+)\s+)?(\w+)?\[data-index="(\d+)"\]$/.exec(selector.trim());
    if (!match) throw Error('fake DOM does not support selector ' + selector);
    const [, id, tag, index] = match, scope = id ? this.ownerDocument.getElementById(id) : this;
    for (const node of scope.descendants()) if (node.dataset.index === index && (!tag || node.tagName === tag.toUpperCase())) return node;
    return null;
  }
}

function dialogPage() {
  const responses = [], ready = [];
  let onInit = null;
  const document = {activeElement: null, listeners: {}, addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }};
  const make = (tag, id) => { const element = new FakeElement(tag, id); element.ownerDocument = document; return element; };
  const byId = Object.fromEntries(['root', 'kicker', 'title', 'detail', 'items', 'actions'].map(id => [id, make(id === 'root' ? 'main' : 'div', id)]));
  byId.root.append(byId.kicker, byId.title, byId.detail, byId.items, byId.actions);
  Object.assign(document, {documentElement: make('html'), getElementById: id => byId[id] || null, createElement: tag => make(tag), querySelector: selector => byId.root.querySelector(selector)});
  const context = {document, Promise, aciraDialog: {onInit: callback => { onInit = callback; }, ready: height => ready.push(height), respond: (...args) => responses.push(args)}};
  context.window = context;
  context.addEventListener = () => {};
  vm.createContext(context);
  vm.runInContext(pageScript, context);
  return {
    context, responses, ready,
    async ask(payload) { onInit(payload); await new Promise(resolve => setTimeout(resolve, 0)); },
    // Electron hands back a structured clone of the page's value; JSON is the same for these plain records.
    sender: {executeJavaScript: code => Promise.resolve().then(() => { const value = vm.runInContext(code, context); return value == null ? value : JSON.parse(JSON.stringify(value)); })},
  };
}

function answerer() {
  const ipcMain = new EventEmitter();
  delete globalThis.__appDialogAnswerer;
  globalThis.__reviews = [];
  answerAppDialogs({ipcMain});
  answerAppDialogs({ipcMain}); // installing twice must not answer twice
  return ipcMain;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const review = {kicker: 'Add extension', title: 'Add JSON Formatter to Acira?', detail: 'For the Personal profile.', buttons: ['Cancel', 'Add extension'], defaultId: 0, cancelId: 0, dark: true, warning: false, popover: false, items: []};

test.after(() => { delete globalThis.__appDialogAnswerer; delete globalThis.__reviews; });

test('the harness answers Acira\'s own review window with "Add extension", like a person clicking it', async () => {
  const ipcMain = answerer(), page = dialogPage();
  assert.equal(ipcMain.listenerCount('acira:dialog-ready'), 1);
  await page.ask(review);
  assert.equal(page.ready.length, 1, 'the dialog page reports it is ready to show');
  ipcMain.emit('acira:dialog-ready', {sender: page.sender}, page.ready[0]);
  await settle();
  assert.deepEqual(page.responses, [[1, undefined]], 'button index 1 (Add extension) answered, the safe default untouched');
  assert.deepEqual(globalThis.__reviews, [{title: 'Add extension', message: 'Add JSON Formatter to Acira?', detail: 'For the Personal profile.', buttons: ['Cancel', 'Add extension'], answer: 1, via: 'acira-dialog'}]);
});

test('each question is answered once, and the next question is answered again', async () => {
  const ipcMain = answerer(), page = dialogPage();
  await page.ask(review);
  ipcMain.emit('acira:dialog-ready', {sender: page.sender}, 240);
  ipcMain.emit('acira:dialog-ready', {sender: page.sender}, 240);
  await settle();
  assert.equal(page.responses.length, 1, 'a repeated ready for the same question does not click again');
  await page.ask({...review, title: 'Add Acira capture probe to Acira?', buttons: ['OK']});
  ipcMain.emit('acira:dialog-ready', {sender: page.sender}, 240);
  await settle();
  assert.deepEqual(page.responses, [[1, undefined], [0, undefined]], 'a one-button question gets its only button');
  assert.deepEqual(globalThis.__reviews.map(item => item.message), ['Add JSON Formatter to Acira?', 'Add Acira capture probe to Acira?']);
});

test('the extension-matrix launch installs the answerer next to the system-dialog stub', () => {
  const source = fs.readFileSync(path.join(root, 'qa/extension-matrix/lib.mjs'), 'utf8');
  const launch = source.slice(source.indexOf('export async function launch'), source.indexOf('export function answerAppDialogs'));
  assert.match(launch, /dialog\.showMessageBox = async/);
  assert.match(launch, /await app\.main\(answerAppDialogs\)/);
});
