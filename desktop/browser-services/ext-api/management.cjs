'use strict';
// chrome.management (WP4), main process: getAll, get, getSelf, setEnabled, uninstall, uninstallSelf — Chromium's behaviour and error strings
// (extensions/browser/api/management/management_api.cc, management_api_constants.h) over Acira's extension manager.
// getSelf and uninstallSelf need no permission (Chromium's feature file); everything else needs "management". The renderer half hides the
// permissioned members from extensions without it, and checks the user gesture (only the page knows its activation).
// Not built yet (answers "Access to extension API denied."): launchApp, createAppShortcut, setLaunchType, generateAppForLink,
// installReplacementWebApp, getPermissionWarningsById, and the onInstalled / onUninstalled / onEnabled / onDisabled events.
const bridge = require('./management/bridge.cjs');
const {extensionInfo, readManifest} = require('./management/info.cjs');

const ACCESS_DENIED = 'Access to extension API denied.';
const noExtension = id => `Failed to find extension with id ${id}.`;
const cantModify = id => `Extension ${id} cannot be modified by user.`;
const uninstallCanceled = id => `Extension ${id} uninstall canceled by user.`;
// How long a request that removes or disables the caller itself waits, so its own answer leaves before its pages and worker are unloaded.
const SELF_DELAY_MS = 40;

module.exports = {
  namespaces: ['management'],
  install(api) {
    const table = api.permissions;
    if (!table) throw new Error('management package needs the permission table');
    const hooks = () => bridge.hooksFor(api.session);
    const loadedExtensions = () => {
      try { const engine = api.session && (api.session.extensions || api.session); return engine && typeof engine.getAllExtensions === 'function' ? engine.getAllExtensions() : []; }
      catch { return []; }
    };

    /** Everything installed in this profile: [{id, manifest, folder, enabled, source, name, version}]. Switched-off extensions come from the manager. */
    function installed() {
      const loaded = new Map(loadedExtensions().map(extension => [extension.id, extension]));
      const seen = new Set(), out = [];
      for (const entry of (hooks() && hooks().entries()) || []) {
        seen.add(entry.id);
        const extension = loaded.get(entry.id);
        if (extension) out.push({id: entry.id, manifest: extension.manifest || {}, folder: extension.path || entry.path, enabled: true, source: entry.source, name: extension.name, version: extension.version});
        else out.push({id: entry.id, manifest: readManifest(entry.path) || {}, folder: entry.path, enabled: false, source: entry.source, name: entry.name, version: entry.version});
      }
      for (const [id, extension] of loaded) if (!seen.has(id)) out.push({id, manifest: extension.manifest || {}, folder: extension.path, enabled: true, source: 'Local folder', name: extension.name, version: extension.version});
      return out;
    }
    const find = id => installed().find(item => item.id === id) || null;
    const info = item => extensionInfo(item, table);
    const requireManagement = event => { if (!table.has(event.extension, 'management')) throw new Error(ACCESS_DENIED); };
    // The caller as a management item, for getSelf when the extension was loaded outside the manager.
    const selfItem = extension => find(extension.id) || {id: extension.id, manifest: extension.manifest || {}, folder: extension.path, enabled: true, source: 'Local folder', name: extension.name, version: extension.version};

    /** Asks the manager for a state change. A caller changing itself is answered first and acted on a moment later. */
    async function change(event, id, type) {
      const manager = hooks();
      if (!manager) throw new Error(cantModify(id));
      const run = async () => {
        const result = await manager.command({type, extensionId: id});
        if (result && result.error) throw new Error(String(result.error));
      };
      if (event.extension && event.extension.id === id) {
        setTimeout(() => { run().catch(error => api.log(`${type} of ${id} failed:`, error && error.message)); }, SELF_DELAY_MS);
        return undefined;
      }
      await run();
      return undefined;
    }

    // Chromium's uninstall confirmation, in Acira's own dialog (app-dialog.cjs): Cancel is the default answer.
    async function confirmRemoval(event, item, self) {
      const dialog = api.dialog;
      if (!dialog || typeof dialog.showMessageBox !== 'function') return false;
      const name = item.name || item.manifest.name || item.id;
      const caller = (event.extension && (event.extension.name || (event.extension.manifest && event.extension.manifest.name))) || event.extension.id;
      const options = {
        type: 'warning', title: api.t('ext.removeTitle'),
        message: api.t('ext.removeMessage', {name}),
        detail: self ? api.t('ext.removeSelfDetail') : api.t('ext.removeByDetail', {caller}),
        buttons: [api.t('dialog.cancel'), api.t('ext.remove')], defaultId: 0, cancelId: 0
      };
      const parent = api.getWindow && api.getWindow();
      const answer = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
      return !!answer && answer.response === 1;
    }

    async function uninstall(event, id, options) {
      const item = find(id);
      if (!item) throw new Error(noExtension(id));
      if (!hooks()) throw new Error(cantModify(id));
      const self = !!event.extension && event.extension.id === id;
      // Another extension's removal is always confirmed; the caller's own only when it asks (showConfirmDialog).
      const confirm = (options && options.showConfirmDialog === true) || !self;
      if (confirm && !(await confirmRemoval(event, item, self))) throw new Error(uninstallCanceled(id));
      return change(event, id, 'remove');
    }

    // Permission checks are done here (check: false): the management namespace is bound for every extension, only some members need the permission.
    api.handle('management.getAll', event => { requireManagement(event); return installed().map(info); }, {check: false});
    api.handle('management.get', (event, id) => {
      requireManagement(event);
      const item = find(id);
      if (!item) throw new Error(noExtension(id));
      return info(item);
    }, {check: false});
    api.handle('management.getSelf', event => info(selfItem(event.extension)), {check: false});
    api.handle('management.setEnabled', async (event, id, enabled) => {
      requireManagement(event);
      const item = find(id);
      if (!item) throw new Error(noExtension(id));
      if (!hooks()) throw new Error(cantModify(id));
      if (item.enabled === (enabled === true)) return undefined; // already in that state: nothing to do
      return change(event, id, enabled ? 'enable' : 'disable');
    }, {check: false});
    api.handle('management.uninstall', (event, id, options) => { requireManagement(event); return uninstall(event, id, options); }, {check: false});
    api.handle('management.uninstallSelf', (event, options) => uninstall(event, event.extension.id, options), {check: false});
    return {};
  },
  ACCESS_DENIED
};
