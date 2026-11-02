'use strict';
// The window is created before content blocking, so tab pages need a hard rule: none before the services. The gate itself is tested here;
// the order in main.cjs is checked from its source (main.cjs cannot be loaded outside Electron), and qa/d-services-gate.mjs proves it live.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('typescript');
const {createServicesGate} = require('../desktop/services-gate.cjs');
const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8').replace(/\r\n/g, '\n');
const mainSource = ts.createSourceFile('main.cjs', main, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

test('the gate is shut until open(), then stays open', async () => {
  const gate = createServicesGate();
  assert.equal(gate.isOpen, false);
  assert.throws(() => gate.assertOpen('A tab page'), /A tab page needs the browser services, which are not ready yet/);
  let settled = false; void gate.ready.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false, 'ready does not resolve early');
  assert.equal(gate.open(), true); await gate.ready; assert.equal(gate.isOpen, true);
  assert.doesNotThrow(() => gate.assertOpen('A tab page'));
  assert.equal(gate.open(), false, 'opening twice is harmless'); assert.equal(gate.fail(new Error('late')), false, 'a late failure cannot shut it again');
  assert.equal(gate.isOpen, true);
});

test('a failed start keeps the gate shut for good and rejects everyone waiting', async () => {
  const gate = createServicesGate(), waiting = gate.ready.then(() => 'ready', error => error.message);
  assert.equal(gate.fail(new Error('content blocking could not start')), true);
  assert.equal(await waiting, 'content blocking could not start');
  assert.equal(gate.open(), false, 'it cannot open after a failure'); assert.equal(gate.isOpen, false);
  assert.throws(() => gate.assertOpen('A browsing session'), /not ready: content blocking could not start/);
});

const at = (needle, from = 0) => { const i = main.indexOf(needle, from); assert.ok(i >= 0, `main.cjs must contain: ${needle}`); return i; };
const body = (name) => {
  assert.equal(mainSource.parseDiagnostics.length, 0, 'main.cjs must parse before its function bodies are checked');
  const declarations = [];
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(mainSource);
  assert.equal(declarations.length, 1, `main.cjs must declare exactly one ${name} function`);
  assert.ok(declarations[0].body, `${name} must have a function body`);
  return declarations[0].body.statements.map(statement => statement.getText(mainSource)).join('\n');
};

test('main.cjs: no tab page or session can be made before the services are open', () => {
  assert.match(body('ensurePage'), /^servicesGate\.assertOpen\('A tab page'\);\s*if\(!pagesAllowed\)throw/, 'ensurePage checks the gate first');
  assert.match(body('configureSession'), /^servicesGate\.assertOpen\('A browsing session'\);/, 'configureSession checks the gate first');
  assert.match(body('syncPages'), /^if\(!mainWindow\|\|!pagesAllowed\)return;/, 'syncPages does nothing until pages are allowed');
});

test('main.cjs: windows first, then content blocking, then the gate opens', () => {
  const windows = at('for(const id of restorableWindowIds())createBrowserWindow('), blocking = at('contentBlocking=createContentBlocking(', windows), opened = at('servicesGate.open()', blocking);
  assert.ok(windows < blocking && blocking < opened, 'createContentBlocking runs after the windows are made and before the gate opens');
  assert.equal(main.indexOf('contentBlocking=createContentBlocking('), blocking, 'and it is created in one place only');
  assert.match(main.slice(blocking, opened + 40), /servicesGate\.open\(\)/);
  assert.match(main.slice(opened, opened + 160), /servicesGate\.fail\(error\)/, 'a failure shuts the gate for good');
});

test('main.cjs: start() needs the services only after the window exists, and opens pages last', () => {
  const start = at('async function start(){'), stop = at('function publishShared(){', start), source = main.slice(start, stop);
  const windowMade = source.indexOf('mainWindow=new BaseWindow('), gate = source.indexOf('await servicesGate.ready');
  assert.ok(windowMade > 0 && gate > windowMade, 'the window is created before start() waits for the services');
  for (const needsServices of ['downloads.reconcile(', 'profileCleanup.prepare(', 'configureSession(require(', 'extensionManager.restore()', 'cookieRestore.attach(']) {
    const first = source.indexOf(needsServices); assert.ok(first > gate, `${needsServices} must come after await servicesGate.ready`);
  }
  const pages = source.indexOf('pagesAllowed=true'), sessions = source.indexOf("startupTrace.mark('sessions-configured')");
  assert.ok(gate < sessions && sessions < pages, 'pages are allowed only after the sessions are configured');
  assert.ok(source.indexOf('syncPages()', pages) > pages, 'the first page sync comes after pages are allowed');
});

test('the interface cannot act on the services before the window is ready', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../desktop/preload.cjs'), 'utf8');
  for (const channel of ['acira:dispatch', 'acira:browser-command', 'acira:service', 'acira:set-layout', 'acira:native', 'acira:extensions', 'acira:setup'])
    assert.ok(new RegExp(`(?:invoke|send)\\('${channel}'`).test(preload) && !preload.includes(`ipcRenderer.invoke('${channel}'`) && !preload.includes(`ipcRenderer.send('${channel}'`), `${channel} goes through the ready gate`);
  assert.ok(preload.includes("ipcRenderer.invoke('acira:window-ready')"));
  assert.ok(main.includes("bridge.handle('acira:window-ready'"), 'main answers the readiness question per window');
});
