'use strict';
// chrome.browsingData: what a call asks for, worked out the way Chromium's browsing_data_api.cc does (BrowsingDataRemoverFunction::Run / GetRemovalMask / ParseOriginTypeMask /
// ParseOrigins), without touching any data: the package (../browsing-data.cjs) runs the plan against Acira's own stores. Pure, so tests/ext-history-browsing-data.test.cjs can read it.
//
// The data types of Chromium (MaskForKey): cache, cookies, downloads, fileSystems, formData, history, indexedDB, localStorage, serviceWorkers, cacheStorage.
// A data type that Chromium never removes any more (appcache, pluginData, passwords, webSQL) is "no effect" with a console warning, as there; a key that is no data type at all
// in remove()'s dataToRemove is the same warning ("Requested data type(s) are not supported: ...") and the call goes on with the rest.

const TYPES = ['cache', 'cookies', 'downloads', 'fileSystems', 'formData', 'history', 'indexedDB', 'localStorage', 'serviceWorkers', 'cacheStorage'];
/** Types kFilterableDataTypes allows an origin filter on (DATA_TYPE_SITE_DATA | DATA_TYPE_CACHE). */
const FILTERABLE = new Set(['cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'cacheStorage', 'cache']);

const ERRORS = {
  deleteProhibited: 'Browsing history and downloads are not permitted to be removed.',
  nonFilterable: "At least one data type doesn't support filtering by origin.",
  incompatibleFilter: "Don't set both 'origins' and 'excludeOrigins' at the same time.",
  invalidOrigin: text => `'${text}' is not a valid origin.`,
  deprecated: 'Requested data type is deprecated.',
  unsupportedWarning: names => `Requested data type(s) are not supported: ${names}.`
};

/** The function name -> what it removes ('remove' reads dataToRemove). Chromium's per-type functions and their fixed masks. */
const FUNCTIONS = {
  remove: null,
  removeAppcache: {types: [], warn: ['appcache']},
  removeCache: {types: ['cache']},
  removeCacheStorage: {types: ['cacheStorage']},
  removeCookies: {types: ['cookies']},
  removeDownloads: {types: ['downloads']},
  removeFileSystems: {types: ['fileSystems']},
  removeFormData: {types: ['formData']},
  removeHistory: {types: ['history']},
  removeIndexedDB: {types: ['indexedDB']},
  removeLocalStorage: {types: ['localStorage']},
  removePluginData: {types: [], warn: ['pluginData']},
  removePasswords: {types: [], warn: ['passwords']},
  removeServiceWorkers: {types: ['serviceWorkers']},
  removeWebSQL: {types: [], warn: ['webSQL']}
};

class BadArguments extends TypeError { constructor(text) { super(text || 'Invalid arguments.'); } }

/** ParseOriginTypeMask: absent = unprotectedWeb only; a given dictionary starts from nothing and takes each true flag. */
function originTypes(options) {
  const mask = {unprotectedWeb: true, protectedWeb: false, extension: false};
  const given = options.originTypes;
  if (given === undefined) return mask;
  if (given === null || typeof given !== 'object' || Array.isArray(given)) throw new BadArguments();
  mask.unprotectedWeb = mask.protectedWeb = mask.extension = false;
  for (const key of ['unprotectedWeb', 'protectedWeb', 'extension']) {
    if (given[key] === undefined) continue;
    if (typeof given[key] !== 'boolean') throw new BadArguments();
    mask[key] = given[key];
  }
  return mask;
}

/** ParseOrigins: every entry an origin (scheme + host), else "'x' is not a valid origin." (an opaque origin). Returns the origins as "scheme://host[:port]". */
function origins(list) {
  const out = [];
  for (const entry of list) {
    if (typeof entry !== 'string') throw new BadArguments();
    let origin = 'null';
    try { origin = new URL(entry).origin; } catch { /* not an address */ }
    if (origin === 'null') throw new Error(ERRORS.invalidOrigin(entry));
    out.push(origin);
  }
  return out;
}

/**
 * The plan of one call: {types, since, originTypes, origins, mode, warnings} or throws (BadArguments for what Chromium's validation refuses, Error for its named errors).
 * `name` is the function ('remove', 'removeHistory', ...); `args` the call's arguments: [options] or, for remove, [options, dataToRemove].
 */
function plan(name, args) {
  if (!Object.hasOwn(FUNCTIONS, name)) throw new BadArguments();
  const options = args[0];
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new BadArguments();
  const types = originTypes(options);
  const since = options.since === undefined ? 0 : Number(options.since);
  if (!Number.isFinite(since)) throw new BadArguments();
  const warnings = [];
  let wanted = [];
  if (name === 'remove') {
    const data = args[1];
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new BadArguments();
    const unsupported = [];
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'boolean') throw new BadArguments();
      if (!value) continue;
      if (TYPES.includes(key)) wanted.push(key); else unsupported.push(key);
    }
    if (unsupported.length) warnings.push(ERRORS.unsupportedWarning(unsupported.join(', ')));
  } else {
    const fixed = FUNCTIONS[name];
    wanted = [...fixed.types];
    if (fixed.warn) warnings.push(ERRORS.unsupportedWarning(fixed.warn.join(', ')));
  }
  if (options.origins !== undefined && options.excludeOrigins !== undefined) throw new Error(ERRORS.incompatibleFilter);
  let list = [], mode = 'preserve';
  if (options.origins !== undefined) {
    if (!Array.isArray(options.origins)) throw new BadArguments();
    list = origins(options.origins);
    if (!list.length) throw new BadArguments();
    mode = 'delete';
  } else if (options.excludeOrigins !== undefined) {
    if (!Array.isArray(options.excludeOrigins)) throw new BadArguments();
    list = origins(options.excludeOrigins);
  }
  if (list.length && wanted.some(type => !FILTERABLE.has(type))) throw new Error(ERRORS.nonFilterable);
  return {types: [...new Set(wanted)], since, originTypes: types, origins: list, mode, warnings};
}

module.exports = {TYPES, FILTERABLE, FUNCTIONS, ERRORS, BadArguments, plan};
