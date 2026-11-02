'use strict';
// chrome.permissions (WP4). Main process: Chromium's behaviour (extensions/browser/api/permissions/permissions_api.cc) over Acira's
// permission table (api.permissions, WP0): getAll / contains / request / remove, onAdded / onRemoved from the table's change feed. Grants
// are the table's (persisted per profile, survive a restart); this file keeps no state. The prompt is the table's request() (WP0); a
// request that Chromium would not warn about (storage, alarms, …) is granted without one, as Chrome does. The user-gesture check lives in
// permissions-renderer.cjs (only the page knows its transient activation).
const {unpack, pack, needsPrompt, effectiveOrigins} = require('./permissions/unpack.cjs');

const NOT_IN_MANIFEST = 'Only permissions specified in the manifest may be requested.';
const CANT_REMOVE_REQUIRED = 'You cannot remove required permissions.';
const restrictedFile = pattern => `Extension must have file access enabled to request '${pattern}'.`;

module.exports = {
  namespaces: ['permissions'],
  install(api) {
    const table = api.permissions;
    if (!table) throw new Error('permissions package needs the permission table');
    const asked = request => (request && typeof request === 'object' ? request : {});

    // permissions.getAll: the active set (manifest + granted optional), content-script hosts included (PackPermissionSet reads effective_hosts).
    api.handle('permissions.getAll', event => {
      const active = table.active(event.extension);
      return pack({permissions: active.permissions, origins: effectiveOrigins(event.extension.manifest || {}, active)});
    });

    // permissions.contains: true when everything asked is held; anything the manifest does not list is simply not held.
    api.handle('permissions.contains', (event, request) => {
      const extension = event.extension;
      const parts = unpack(table, extension, asked(request));
      if (parts.apis.unlisted.length || parts.origins.unlisted.length || parts.origins.restricted.length) return false;
      const active = table.active(extension);
      const apisHeld = [...parts.apis.required, ...parts.apis.optional].every(name => active.permissions.includes(name));
      const hostsHeld = table.contains(extension, {origins: [...parts.origins.required, ...parts.origins.optional]});
      // Content-script hosts are always held (scriptable_hosts of the initial active set).
      return apisHeld && hostsHeld;
    });

    // permissions.request: only what the manifest lists as optional can be added; what is already held resolves true at once.
    api.handle('permissions.request', async (event, request) => {
      const extension = event.extension;
      const parts = unpack(table, extension, asked(request));
      if (parts.apis.unlisted.length || parts.origins.unlisted.length) throw new Error(NOT_IN_MANIFEST);
      if (parts.origins.restricted.length) throw new Error(restrictedFile(parts.origins.restricted[0]));
      const active = table.active(extension);
      const fresh = {
        permissions: parts.apis.optional.filter(name => !active.permissions.includes(name)),
        origins: parts.origins.optional.filter(origin => !table.contains(extension, {origins: [origin]}))
      };
      if (!fresh.permissions.length && !fresh.origins.length) return true;
      if (!needsPrompt(fresh)) {
        table.grant(extension, fresh);
        return table.contains(extension, fresh);
      }
      return (await table.request(extension, fresh, {event})) === true;
    });

    // permissions.remove: optional permissions only; always resolves true (a permission that was not held is silently ignored).
    api.handle('permissions.remove', (event, request) => {
      const extension = event.extension;
      const parts = unpack(table, extension, asked(request));
      if (parts.apis.unlisted.length || parts.origins.unlisted.length) throw new Error(NOT_IN_MANIFEST);
      if (parts.apis.required.length || parts.origins.required.length || parts.origins.scriptable.length) throw new Error(CANT_REMOVE_REQUIRED);
      table.revoke(extension, {permissions: parts.apis.optional, origins: parts.origins.optional});
      return true;
    });

    // onAdded / onRemoved carry the set that changed, as {permissions, origins} (PermissionsUpdater::NotifyPermissionsUpdated).
    const off = table.onChange((id, {added, removed}) => {
      if (added.permissions.length || added.origins.length) api.emit(id, 'permissions.onAdded', pack(added));
      if (removed.permissions.length || removed.origins.length) api.emit(id, 'permissions.onRemoved', pack(removed));
    });
    return {dispose: off};
  },
  NOT_IN_MANIFEST,
  CANT_REMOVE_REQUIRED
};
