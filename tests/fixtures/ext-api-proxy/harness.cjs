'use strict';
// A fake main process for the P6 packages (proxy, privacy, cookies): the engine's router, a session that records what is done to it,
// extensions with real manifests and the real permission table. Shared by tests/ext-api-proxy*.test.cjs, ext-api-privacy*.test.cjs and
// ext-api-cookies*.test.cjs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const extApi = require('../../../desktop/browser-services/ext-api/index.cjs');
const {createPermissionTable} = require('../../../desktop/browser-services/extension-permission-table.cjs');
const chromeSettings = require('../../../desktop/browser-services/extension-chrome-settings.cjs');

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);
const manifest = (permissions = [], extra = {}) => ({manifest_version: 3, name: 'Ext', version: '1', permissions, ...extra});

function fakeSession({tor = false, cookies: jar} = {}) {
  const calls = [];
  const emitter = new (require('node:events'))();
  const session = {
    calls, extensions: emitter,
    async setProxy(config) { calls.push(['setProxy', config]); if (session.failProxy) throw new Error('bad proxy'); },
    async closeAllConnections() { calls.push(['closeAllConnections']); },
    cookies: jar || new (require('node:events'))()
  };
  if (tor) session.__aciraTor = true;
  return session;
}

/**
 * world({packages: ['proxy'], extensions: {[id]: {name, manifest}}, session, storeKey}) ->
 *   {call(id, name, ...args), calls, sent, listen(id, event), handlers, session, extensions, dispose(), userData, host}
 */
function world({packages = ['proxy'], extensions = {}, session = fakeSession(), storeKey = 'profile-1', userData, contents = [] } = {}) {
  userData = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'acira-p6-'));
  const handlers = new Map(), sent = [], listeners = new Map();
  const router = {
    handlers, listeners,
    handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); },
    sendEvent: (id, name, ...args) => sent.push([id, name, ...args]),
    broadcastEvent: (name, ...args) => sent.push(['*', name, ...args])
  };
  const loaded = new Map();
  const extensionObjects = new Map();
  const add = (id, spec) => { const extension = {id, name: spec.name || id, manifest: spec.manifest}; loaded.set(id, spec); extensionObjects.set(id, extension); return extension; };
  for (const [id, spec] of Object.entries(extensions)) add(id, spec);
  const getExtension = id => extensionObjects.get(id) || null;
  const permissions = createPermissionTable({userData, storeKey, getExtension});
  const base = {session, runtime: {ctx: {router, store: {tabs: new Set(contents)}}}, router, userData, storeKey, getWindow: () => null, getExtension, permissions, log() {}, t: id => id};
  const list = extApi.loadPackages({fresh: true}).filter(pkg => packages.includes(pkg.name));
  const installed = extApi.installPackages(base, {packages: list, log: (...args) => { throw new Error(args.join(' ')); }});
  const listen = (id, event) => { const entries = listeners.get(event) || []; entries.push({extensionId: id}); listeners.set(event, entries); };
  const call = async (id, name, ...args) => {
    const entry = handlers.get(name);
    if (!entry) throw new Error(`no handler ${name}`);
    const extension = getExtension(id);
    const answer = await entry.callback({type: 'service-worker', sender: null, extension}, ...args);
    if (answer && typeof answer === 'object' && typeof answer.__acira_error === 'string') throw new Error(answer.__acira_error);
    return answer && typeof answer === 'object' && '__acira_value' in answer ? answer.__acira_value : answer;
  };
  return {call, sent, listen, handlers, session, userData, storeKey, installed, add, getExtension, permissions,
    store: () => chromeSettings.forProfile(storeKey, {userData}),
    load: (id, spec) => { const extension = add(id, spec); session.extensions.emit('extension-loaded', {}, extension); return extension; },
    unload: id => { extensionObjects.delete(id); session.extensions.emit('extension-unloaded', {}, {id}); },
    dispose() { installed.dispose(); try { fs.rmSync(userData, {recursive: true, force: true}); } catch { /* temp */ } chromeSettings.reset(); }};
}

module.exports = {world, fakeSession, manifest, A, B, C};
