'use strict';
// chrome.notifications (ext-api/notifications*.cjs): create/update/clear/getAll with Chromium's checks, buttons, onClicked / onButtonClicked /
// onClosed, the presenter (nothing is shown in a test), and the extension page/worker side.
const test = require('node:test');
const assert = require('node:assert/strict');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const notifications = require('../desktop/browser-services/ext-api/notifications.cjs');
const presenters = require('../desktop/browser-services/ext-api/notifications/presenter.cjs');
const bridge = require('../desktop/browser-services/ext-api/surfaces/bridge.cjs');
const {host, ID, ID2, manifestExtension} = require('./fixtures/ext-api-p8/host.cjs');
const {extensionWorld, plain} = require('./fixtures/ext-api/world.cjs');

function notifyHost(extra = {}) {
  const presenter = presenters.stubPresenter();
  notifications.presenter = presenter;
  const h = host({packages: ['notifications'], ...extra});
  h.presenter = presenter;
  h.controller = () => bridge.all('notifications').find(entry => entry.session === h.session).controller;
  return h;
}
const basic = (extra = {}) => ({type: 'basic', iconUrl: 'icon.png', title: 'Title', message: 'Message', ...extra});
const done = () => { notifications.presenter = undefined; };

test('create: required properties, ids, replacing, getAll as an object, permission level', async () => {
  const h = notifyHost();
  try {
    const call = (name, ...args) => h.call(`notifications.${name}`, null, ...args);
    assert.deepEqual(await call('create', null, {type: 'basic', title: 'x', message: 'y'}), {__acira_error: 'Some of the required properties are missing: type, iconUrl, title and message are required.'});
    assert.deepEqual(await call('create', 'l', {type: 'list', iconUrl: 'i.png', title: 't', message: 'm'}), {__acira_error: 'List items must be provided for list type'});
    assert.deepEqual(await call('create', 'p', basic({type: 'progress', progress: 101})), {__acira_error: 'The progress value should range from 0 to 100'});
    assert.deepEqual(await call('create', 'b', basic({buttons: [{title: 'a'}, {title: 'b'}, {title: 'c'}]})), {__acira_error: 'The notification may have at most 2 buttons'});
    const generated = await call('create', null, basic());
    assert.match(generated, /^[0-9a-f-]{36}$/, 'no id: a generated one');
    assert.equal(await call('create', 'mine', basic()), 'mine');
    assert.equal(await call('create', 'mine', basic({title: 'Again'})), 'mine', 'the same id replaces');
    assert.equal(h.presenter.shown.get(`${ID}\u0000mine`).options.title, 'Again');
    assert.deepEqual(await call('getAll'), {[generated]: true, mine: true});
    assert.equal(await call('getPermissionLevel'), 'granted');
  } finally { done(); }
});

test('update changes what is shown, clear removes it and tells onClosed it was not the person', async () => {
  const h = notifyHost();
  try {
    const call = (name, ...args) => h.call(`notifications.${name}`, null, ...args);
    await call('create', 'n', basic({progress: 10, type: 'progress'}));
    assert.equal(await call('update', 'n', {progress: 60}), true);
    assert.equal(h.presenter.shown.get(`${ID}\u0000n`).options.progress, 60);
    assert.equal(await call('update', 'missing', {title: 'x'}), false);
    assert.equal(await call('clear', 'missing'), false);
    assert.equal(await call('clear', 'n'), true);
    assert.deepEqual(h.sent, [[ID, 'notifications.onClosed', 'n', false]]);
    assert.deepEqual(await call('getAll'), {});
    assert.equal(h.presenter.shown.size, 0);
  } finally { done(); }
});

test('events: a click, a button and a dismissal reach the extension; a click or button also closes the notification', async () => {
  const h = notifyHost();
  try {
    const call = (name, ...args) => h.call(`notifications.${name}`, null, ...args);
    await call('create', 'a', basic({buttons: [{title: 'Yes'}, {title: 'No'}]}));
    await call('create', 'b', basic());
    await call('create', 'c', basic());
    const controller = h.controller();
    assert.equal(controller.interact(ID, 'a', 'button', 1), true);
    assert.equal(controller.interact(ID, 'b', 'click'), true);
    assert.equal(controller.interact(ID, 'c', 'close', true), true);
    assert.equal(controller.interact(ID, 'a', 'click'), false, 'already gone');
    assert.deepEqual(h.sent, [
      [ID, 'notifications.onButtonClicked', 'a', 1], [ID, 'notifications.onClosed', 'a', true],
      [ID, 'notifications.onClicked', 'b'], [ID, 'notifications.onClosed', 'b', true],
      [ID, 'notifications.onClosed', 'c', true]]);
    assert.deepEqual(await call('getAll'), {});
  } finally { done(); }
});

test('notifications belong to their extension and go when it is removed', async () => {
  const h = notifyHost({extensions: [manifestExtension(ID, {manifest_version: 3, name: 'A', version: '1', permissions: ['notifications']}), manifestExtension(ID2, {manifest_version: 3, name: 'B', version: '1', permissions: ['notifications']})]});
  try {
    await h.call('notifications.create', h.ext(ID), 'same', basic());
    await h.call('notifications.create', h.ext(ID2), 'same', basic());
    assert.deepEqual(await h.call('notifications.getAll', h.ext(ID)), {same: true});
    assert.equal(await h.call('notifications.clear', h.ext(ID), 'same'), true);
    assert.deepEqual(await h.call('notifications.getAll', h.ext(ID2)), {same: true}, 'the other extension keeps its own');
    h.sessionExtensions.fire('extension-unloaded', h.ext(ID2));
    assert.equal(h.presenter.shown.size, 0);
  } finally { done(); }
});

test('without the notifications permission the namespace is Chromium\'s denied answer', async () => {
  const h = notifyHost({extensions: [manifestExtension(ID, {manifest_version: 3, name: 'A', version: '1', permissions: []})], permissions: {has: (extension, name) => (extension.manifest.permissions || []).includes(name)}});
  try { assert.deepEqual(await h.call('notifications.getAll', null), {__acira_error: 'Access to extension API denied.'}); } finally { done(); }
});

test('presenter: text for list and progress types, the icon only from the extension or a data URL', () => {
  assert.equal(presenters.textOf({type: 'basic', message: 'Hello', contextMessage: 'from me'}), 'Hello\nfrom me');
  assert.equal(presenters.textOf({type: 'list', message: 'x', items: [{title: 'a', message: '1'}, {title: 'b', message: '2'}]}), 'a: 1\nb: 2');
  assert.equal(presenters.textOf({type: 'progress', message: 'Copying', progress: 42.4}), 'Copying (42%)');
  const images = {createFromDataURL: url => ({data: url}), createFromPath: file => ({file, isEmpty: () => false})};
  assert.deepEqual(presenters.iconOf({path: ''}, 'data:image/png;base64,AA', images), {data: 'data:image/png;base64,AA'});
  assert.equal(presenters.iconOf({path: __dirname}, 'https://example.com/i.png', images), undefined, 'no network from the main process');
  assert.equal(presenters.iconOf({path: __dirname}, '../escape.png', images), undefined);
  assert.equal(presenters.iconOf({path: __dirname}, 'ext-api-notifications.test.cjs', images).file.endsWith('ext-api-notifications.test.cjs'), true);
});

test('presenter: the system notification carries the buttons as actions and reports the person\'s choice', () => {
  const made = [];
  class FakeNotification {
    constructor(options) { this.options = options; this.handlers = {}; made.push(this); }
    static isSupported() { return true; }
    on(name, fn) { this.handlers[name] = fn; }
    show() { this.shown = true; }
    close() { this.closed = true; }
  }
  const presenter = presenters.systemPresenter({Notification: FakeNotification, nativeImage: {}, appName: 'Acira'});
  const calls = [];
  const handle = presenter.show({extension: {path: ''}, options: basic({buttons: [{title: 'Open'}, {title: 'Later'}], requireInteraction: true, priority: 2, silent: true})},
    {click: () => calls.push('click'), action: index => calls.push(['action', index]), close: byUser => calls.push(['close', byUser])});
  const n = made[0];
  assert.deepEqual(n.options.actions, [{type: 'button', text: 'Open'}, {type: 'button', text: 'Later'}]);
  assert.equal(n.options.timeoutType, 'never');
  assert.equal(n.options.urgency, 'critical');
  assert.equal(n.options.silent, true);
  assert.equal(n.shown, true);
  n.handlers.action({actionIndex: 1}, 1);
  n.handlers.click();
  n.handlers.close({reason: 'timedOut'});
  n.handlers.close({reason: 'userCanceled'});
  assert.deepEqual(calls, [['action', 1], 'click', ['close', false], ['close', true]]);
  handle.close();
  assert.equal(n.closed, true);
  n.handlers.close({reason: 'userCanceled'});
  assert.equal(calls.length, 4, 'closing it ourselves is quiet');
});

function world(manifest, options = {}) {
  const packages = extApi.loadPackages({fresh: true}).filter(p => p.name === 'notifications');
  return extensionWorld({name: 'x', version: '1', permissions: ['notifications'], ...manifest}, {packages, ...options});
}

test('extension side: promise and callback forms, Chromium\'s argument checks, the three events', async () => {
  const calls = [];
  const w = world({manifest_version: 3}, {worker: true, answer: (name, args) => { calls.push([name, args]); return name === 'notifications.create' ? 'made' : name === 'notifications.clear' ? true : name === 'notifications.getAll' ? {made: true} : undefined; }});
  const {chrome} = w;
  assert.equal(await chrome.notifications.create('made', basic()), 'made');
  assert.equal(await chrome.notifications.create(basic()), 'made');
  assert.deepEqual(plain(calls[1][1]), [null, basic()], 'no id: null');
  const viaCallback = await new Promise(resolve => chrome.notifications.clear('made', resolve));
  assert.equal(viaCallback, true);
  assert.deepEqual(plain(await chrome.notifications.getAll()), {made: true});
  assert.throws(() => chrome.notifications.create('x', {type: 'bogus', iconUrl: 'i', title: 't', message: 'm'}), /Error in invocation of notifications\.create/);
  const seen = [];
  chrome.notifications.onClicked.addListener(id => seen.push(['click', id]));
  chrome.notifications.onButtonClicked.addListener((id, index) => seen.push(['button', id, index]));
  chrome.notifications.onClosed.addListener((id, byUser) => seen.push(['closed', id, byUser]));
  w.emit('notifications.onClicked', 'n'); w.emit('notifications.onButtonClicked', 'n', 1); w.emit('notifications.onClosed', 'n', true);
  assert.deepEqual(seen, [['click', 'n'], ['button', 'n', 1], ['closed', 'n', true]]);
});
