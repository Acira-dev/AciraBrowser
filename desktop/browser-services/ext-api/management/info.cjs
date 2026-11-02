'use strict';
// chrome.management.ExtensionInfo, built the way CreateExtensionInfo does (extensions/browser/api/management/management_api.cc) from an
// installed extension: a loaded Electron Extension or, for one that is switched off, the manifest read from its folder.
const fs = require('node:fs');
const path = require('node:path');
const {normalize} = require('../permissions/unpack.cjs');

const STORE_UPDATE_URL = 'https://clients2.google.com/service/update2/crx';
const STORE_PAGE = id => `https://chromewebstore.google.com/detail/${id}`;

/** manifest.json of an extension folder, or null (a missing, unreadable or oversized file). */
function readManifest(folder) {
  try {
    if (typeof folder !== 'string' || !folder) return null;
    const file = path.join(folder, 'manifest.json');
    if (fs.statSync(file).size > 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

const messageCache = new Map();
/** _locales/<default_locale>/messages.json, for __MSG_key__ placeholders in name and description. */
function localeMessages(folder, manifest) {
  if (!folder || typeof manifest.default_locale !== 'string') return {};
  const locale = manifest.default_locale.replace(/[^A-Za-z0-9_-]/g, '');
  const file = path.join(folder, '_locales', locale, 'messages.json');
  if (messageCache.has(file)) return messageCache.get(file);
  let messages = {};
  try {
    if (fs.statSync(file).size < 2 * 1024 * 1024) messages = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch { messages = {}; }
  if (messageCache.size > 200) messageCache.clear();
  messageCache.set(file, messages);
  return messages;
}
function localize(text, messages) {
  return String(text == null ? '' : text).replace(/__MSG_([A-Za-z0-9_@]+)__/g, (whole, key) => {
    const found = messages[key] || messages[Object.keys(messages).find(name => name.toLowerCase() === key.toLowerCase())];
    return found && typeof found.message === 'string' ? found.message : whole;
  });
}

/** Absolute chrome-extension:// URL of a manifest path ("/options.html" and "options.html" alike), or '' for a non-string. */
const extensionUrl = (id, file) => (typeof file === 'string' && file ? `chrome-extension://${id}/${file.replace(/^\/+/, '')}` : '');

/**
 * item: {id, manifest, folder?, name?, version?, enabled, source?}   (source: 'Chrome Web Store' | 'Local folder' | …)
 * table: Acira's permission table (api.permissions) for the active permission set.
 */
function extensionInfo(item, table) {
  const manifest = item.manifest || {};
  const id = item.id;
  const messages = localeMessages(item.folder, manifest);
  // Electron's Extension.name is already localized; a raw placeholder (a switched-off extension saved before it was) is resolved here.
  const name = (item.name && !/__MSG_/.test(item.name) ? item.name : '') || localize(manifest.name, messages) || id;
  const shortName = localize(manifest.short_name, messages) || name;
  const active = table.active({id, manifest});
  const fromStore = item.source === 'Chrome Web Store';
  const icons = Object.entries(manifest.icons && typeof manifest.icons === 'object' ? manifest.icons : {})
    .filter(([size, file]) => /^\d+$/.test(size) && typeof file === 'string' && file)
    .map(([size, file]) => ({size: Number(size), url: extensionUrl(id, file)}))
    .sort((a, b) => a.size - b.size);
  const homepage = typeof manifest.homepage_url === 'string' && /^https?:\/\//i.test(manifest.homepage_url) ? manifest.homepage_url : (fromStore ? STORE_PAGE(id) : '');
  const updateUrl = fromStore ? STORE_UPDATE_URL : (typeof manifest.update_url === 'string' && /^https?:\/\//i.test(manifest.update_url) ? manifest.update_url : '');
  const info = {
    id,
    name,
    shortName,
    description: localize(manifest.description, messages),
    version: String(manifest.version || item.version || ''),
    versionName: typeof manifest.version_name === 'string' ? manifest.version_name : '',
    mayDisable: true,
    enabled: !!item.enabled,
    isApp: false,
    type: manifest.theme && typeof manifest.theme === 'object' ? 'theme' : 'extension',
    homepageUrl: homepage,
    offlineEnabled: manifest.offline_enabled === true,
    optionsUrl: extensionUrl(id, (manifest.options_ui && manifest.options_ui.page) || manifest.options_page),
    permissions: [...active.permissions].sort(),
    hostPermissions: active.origins.map(normalize),
    installType: item.source && item.source !== 'Local folder' ? 'normal' : 'development'
  };
  if (!info.enabled) { info.disabledReason = 'unknown'; info.mayEnable = true; }
  if (updateUrl) info.updateUrl = updateUrl;
  if (icons.length) info.icons = icons;
  return info;
}

module.exports = {extensionInfo, readManifest, localize, extensionUrl};
