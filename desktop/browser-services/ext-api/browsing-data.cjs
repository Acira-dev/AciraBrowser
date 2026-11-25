'use strict';
// chrome.browsingData, main process (14.3, D158: an extension that clears browsing history left Acira's History full). Copied from Chromium's
// browsing_data_api.cc: the same functions, the same options (since, originTypes, origins / excludeOrigins), the same errors and warnings (browsing-data/plan.cjs).
//
// What it acts on, for THIS extension's profile only (never another profile's, and a private profile has no history, downloads or stored data of this kind):
//   history     the profile's visits in Acira's History list (since: visits from that time on)           history/host.cjs   -> the same action the History page uses
//   downloads   the profile's finished downloads in Acira's Downloads list (records, never the files)    downloads/host.cjs -> the same erase chrome.downloads.erase uses
//   cache, cookies, localStorage, indexedDB, serviceWorkers, cacheStorage, fileSystems
//               the profile's own browsing session, for all time and every origin. Acira cannot take a time range or an origin filter off its session's stores
//               (Electron has no creation time on a cookie, no per-origin cache), so a call with a `since` after the beginning or an origin filter does not touch these:
//               it answers with Chromium's "Requested data type(s) are not supported: ..." console warning for them and still does the rest (history, downloads).
//   formData    Acira keeps no saved form data: the same warning.
//   originTypes only "unprotectedWeb" has data in Acira (no hosted apps, and an extension's own data is never cleared this way).
// Permission: the 'browsingData' permission, as in Chromium's _permission_features (without it the namespace is not there).
const plans = require('./browsing-data/plan.cjs');
const history = require('./history/host.cjs');
const downloads = require('./downloads/host.cjs');

const STORAGES = {cookies: 'cookies', localStorage: 'localstorage', indexedDB: 'indexdb', serviceWorkers: 'serviceworkers', cacheStorage: 'cachestorage', fileSystems: 'filesystem'};
const RUNNING = new Set(['Downloading', 'Paused']);
/** The data types of browsingData.settings(): which ones this build can remove at all (permitted) and which the person has selected (none: Acira's own Clear browsing data keeps nothing for extensions). */
const PERMITTED = {cookies: true, fileSystems: true, indexedDB: true, localStorage: true, serviceWorkers: true, cacheStorage: true, pluginData: false, history: true, downloads: true, cache: true, formData: false, passwords: false};

module.exports = {
  namespaces: ['browsingData'],
  install(api) {
    const profileId = api.storeKey, privateProfile = String(profileId).startsWith('private-');
    const allow = event => { if (api.permissions && event && event.extension && !api.permissions.has(event.extension, 'browsingData')) throw new Error("The 'browsingData' API requires the 'browsingData' permission."); };

    api.handle('browsingData.settings', event => {
      allow(event);
      return {
        options: {originTypes: {unprotectedWeb: true, protectedWeb: false, extension: false}, since: 0},
        dataToRemove: Object.fromEntries(Object.keys(PERMITTED).map(key => [key, false])),
        dataRemovalPermitted: {...PERMITTED}
      };
    });

    async function removeHistory(since) {
      const store = history.store();
      if (!store) throw new Error('Acira cannot change its history now.');
      const ids = privateProfile ? [] : store.records(profileId).filter(visit => Date.parse(visit.time) >= since).map(visit => visit.id);
      if (ids.length) await store.remove(profileId, ids);
    }
    async function removeDownloads(since) {
      const host = downloads.current();
      if (!host) throw new Error('Acira cannot change its downloads now.');
      if (privateProfile) return;
      // A transfer that is still running is not a record of the past: Chromium's RemoveDownloadsBetween leaves it.
      const records = host.records(profileId).filter(record => record && !record.private && record.browserProfileId === profileId && !RUNNING.has(record.status) && (Number(record.startedAt) || 0) >= since);
      if (!records.length) return;
      await host.erase(profileId, records.map(record => record.id));
      for (const record of records) downloads.emit({type: 'erased', profileId, record});
    }
    async function removeSession(types, plan) {
      if (!plan.originTypes.unprotectedWeb) return;   // protected web and extension data: none in Acira
      const session = api.session;
      if (privateProfile || !session || session.__aciraTor) throw new Error('Access to extension API denied.');
      if (types.includes('cache')) await session.clearCache();
      const storages = types.filter(type => STORAGES[type]).map(type => STORAGES[type]);
      if (storages.length) await session.clearStorageData({storages});
    }

    function define(name) {
      api.handle('browsingData.' + name, async (event, ...args) => {
        allow(event);
        const plan = plans.plan(name, args), warnings = [...plan.warnings];
        const dataTypes = [], siteTypes = [];
        for (const type of plan.types) {
          if (type === 'history' || type === 'downloads') dataTypes.push(type);
          else if (type === 'formData') warnings.push(plans.ERRORS.unsupportedWarning('formData'));
          else if (plan.since > 0 || plan.origins.length) warnings.push(plans.ERRORS.unsupportedWarning(type));
          else siteTypes.push(type);
        }
        // Chromium: history and downloads take no origin filter (kNonFilterableError, raised in plan()); their `since` is honoured.
        if (dataTypes.includes('history')) await removeHistory(plan.since);
        if (dataTypes.includes('downloads')) await removeDownloads(plan.since);
        if (siteTypes.length) await removeSession(siteTypes, plan);
        return warnings.length ? {__acira_warnings: warnings} : undefined;
      });
    }
    for (const name of Object.keys(plans.FUNCTIONS)) define(name);
    return {dispose() {}};
  }
};
