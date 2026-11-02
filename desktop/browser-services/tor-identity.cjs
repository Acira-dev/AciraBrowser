'use strict';
// Tor sessions only (ordinary sessions: chrome-identity.cjs). Tor pages must all look alike and must not change: this is the identity they have
// always had, with no Acira token in the user agent (user-agent.cjs applyTorUserAgent). Do not make it follow the ordinary identity.
// One consistent Chrome identity. Google (and others) decide "is this Chrome?" from the User-Agent AND the client-hint brand list
// ("Google Chrome" must be present next to "Chromium"); Electron reports only Chromium + a GREASE brand, so Google offers "Switch to Chrome".
// The brand list is generated exactly the way Chromium does it (components/embedder_support/user_agent_utils.cc: GREASE name, version and
// ordering are all derived from the major version), with "Google Chrome" as the product brand, and is applied to the three places a site can read it:
//   1. request headers: Sec-CH-UA and Sec-CH-UA-Full-Version-List (rewritten, never invented: only when Chromium already sends them)
//   2. navigator.userAgentData.brands / toJSON() / getHighEntropyValues() in every website frame (preload, runs before page scripts)
//   3. navigator.languages / navigator.language, so they equal the Accept-Language the profile sends
//   4. window.chrome = { loadTimes, csi, app }: the object Chrome gives every web page (Electron's is empty, the classic "Chrome UA on an embedded runtime" tell)
//      Every replacement function is built native-looking (no prototype, not constructible, native name/length, "[native code]" text).
// Versions come from the running Chromium, so they follow Electron upgrades. No automation flag is touched; nothing here helps solve CAPTCHAs.
const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'], GREASE_VERSIONS = ['8', '99', '24'];
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const PRODUCT = 'Google Chrome';

function majorOf(version) { const major = Number.parseInt(String(version).split('.')[0], 10); if (!Number.isSafeInteger(major) || major < 1) throw Error('A Chromium version is required.'); return major; }

/** Chromium's GenerateBrandVersionList: [{brand, version}] in Chromium's own order. `full` uses the full version for real brands and "N.0.0.0" for the GREASE brand. */
function brandList(version, { full = false } = {}) {
  const major = majorOf(version), seed = major, order = ORDERS[seed % 6];
  const grease = { brand: `Not${GREASE_CHARS[seed % 11]}A${GREASE_CHARS[(seed + 1) % 11]}Brand`, version: full ? GREASE_VERSIONS[seed % 3] + '.0.0.0' : GREASE_VERSIONS[seed % 3] };
  const real = full ? String(version) : String(major), list = [];
  list[order[0]] = grease; list[order[1]] = { brand: 'Chromium', version: real }; list[order[2]] = { brand: PRODUCT, version: real };
  return list;
}
const header = list => list.map(item => `"${item.brand}";v="${item.version}"`).join(', ');

/** Everything derived from one Chromium version: low/high-entropy lists and their header forms. */
function createIdentity(chromiumVersion) {
  const major = majorOf(chromiumVersion), brands = brandList(chromiumVersion), fullVersionList = brandList(chromiumVersion, { full: true });
  return { major, fullVersion: String(chromiumVersion), brands, fullVersionList, secChUa: header(brands), secChUaFullVersionList: header(fullVersionList) };
}

/** Rewrites only the client-hint headers Chromium already attached. Keeps the header's own capitalisation. Returns {} when nothing changes. */
function rewriteHeaders(identity, requestHeaders) {
  if (!requestHeaders) return {};
  let next = null;
  for (const name of Object.keys(requestHeaders)) {
    const lower = name.toLowerCase();
    let value = null;
    if (lower === 'sec-ch-ua') value = identity.secChUa;
    else if (lower === 'sec-ch-ua-full-version-list') {
      // Keep the full version Chromium reported for its own brand (it may have been reduced or kept); only add/replace the brand list shape.
      const native = String(requestHeaders[name]).match(/"Chromium";v="([^"]+)"/);
      value = native ? header(brandList(native[1], { full: true })) : identity.secChUaFullVersionList;
    }
    if (value !== null && requestHeaders[name] !== value) { next ||= { ...requestHeaders }; next[name] = value; }
  }
  return next ? { requestHeaders: next } : {};
}

const PLATFORM_NAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
const SECURE_URL = /^(?:https:|http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$))/i;
/**
 * Request-header hook. Electron's navigations, worker scripts and service-worker scripts carry no Sec-CH-UA at all (Chromium only attaches the low-entropy
 * hints to renderer fetches), while Chrome sends Sec-CH-UA, Sec-CH-UA-Mobile and Sec-CH-UA-Platform on every request to a secure origin. A page request
 * missing them gets them here, with the same values the page reads; requests made by the application itself (no page behind them) are left alone.
 */
function sendHeaders(identity, details, platform = process.platform) {
  const headers = details.requestHeaders || {}, rewritten = rewriteHeaders(identity, headers);
  const destination = String(Object.entries(headers).find(([name]) => name.toLowerCase() === 'sec-fetch-dest')?.[1] || '').toLowerCase();
  const pageRequest = Boolean(details.webContents || details.webContentsId) || ['mainFrame', 'subFrame', 'worker', 'sharedWorker', 'serviceWorker'].includes(details.resourceType)
    || ['document', 'iframe', 'frame', 'worker', 'sharedworker', 'serviceworker'].includes(destination);
  if (!pageRequest || !SECURE_URL.test(String(details.url || '')) || !PLATFORM_NAMES[platform]) return rewritten;
  const have = new Set(Object.keys(headers).map(name => name.toLowerCase())), add = {};
  if (!have.has('sec-ch-ua')) add['Sec-CH-UA'] = identity.secChUa;
  if (!have.has('sec-ch-ua-mobile')) add['Sec-CH-UA-Mobile'] = '?0';
  if (!have.has('sec-ch-ua-platform')) add['Sec-CH-UA-Platform'] = `"${PLATFORM_NAMES[platform]}"`;
  if (!Object.keys(add).length) return rewritten;
  return { requestHeaders: { ...(rewritten.requestHeaders || headers), ...add } };
}

/** The language list a website can read. A saved choice (or Tor) is used as is; otherwise only the first system language, matching Chromium's reduced Accept-Language. */
function pageLanguages(effective) { const list = Array.isArray(effective) ? effective.filter(tag => typeof tag === 'string' && tag) : []; return list.length ? list.slice(0, 8) : ['en-US']; }

/** JavaScript for one frame (run in the page's own world before its scripts). */
function scriptFor(identity, languages) { return '(' + inject.toString() + ')(' + JSON.stringify({ brands: identity.brands, languages: pageLanguages(languages) }) + ');'; }

/* eslint-disable */
// Self-contained: stringified and executed in each website frame.
function inject(cfg) {
  'use strict';
  try {
    const nativeToString = Function.prototype.toString, disguised = new WeakMap();
    // Page scripts run after this and may replace any built-in. Whatever the replacements call at page time is taken now: a page that swapped
    // Reflect.apply was handed the engine's own brands getter / getHighEntropyValues (the real "Chromium"-only list), one that swapped
    // Promise.prototype.then saw the real fullVersionList, and WeakMap.prototype.get / Function.prototype.call ran inside toString.
    const apply = Reflect.apply, weakGet = WeakMap.prototype.get, then = Promise.prototype.then, map = Array.prototype.map, find = Array.prototype.find, isArray = Array.isArray;
    // Every replacement below is built so that a page cannot tell it from the engine's own function: method/getter shorthand gives it no
    // "prototype" and makes it non-constructible (a plain function expression is neither), its name and length are the original's, and
    // Function.prototype.toString answers with the original's "[native code]" text.
    const toStringPatch = ({ toString() { const text = apply(weakGet, disguised, [this]); return text !== undefined ? text : apply(nativeToString, this, []); } }).toString;
    disguised.set(toStringPatch, 'function toString() { [native code] }');
    Object.defineProperty(Function.prototype, 'toString', { value: toStringPatch, writable: true, configurable: true });
    const mark = (fn, text) => { disguised.set(fn, text); return fn; };
    const sameLength = (fn, length) => { try { Object.defineProperty(fn, 'length', { value: length, configurable: true }); } catch { } return fn; };
    /** A getter named "get <key>" that first lets the engine's own getter judge the receiver (so a wrong `this` still throws "Illegal invocation"). */
    const makeGetter = (key, original, impl) => mark(Object.getOwnPropertyDescriptor({ get [key]() { apply(original, this, []); return apply(impl, this, []); } }, key).get, apply(nativeToString, original, []));
    const makeMethod = (key, original, impl) => mark(sameLength(({ [key](...args) { return apply(impl, this, args); } })[key], original.length), apply(nativeToString, original, []));
    const copyBrands = () => apply(map, brands, [item => ({ brand: item.brand, version: item.version })]);
    const freezeAll = list => Object.freeze(list.map(item => Object.freeze({ brand: item.brand, version: item.version })));
    const brands = freezeAll(cfg.brands), languages = Object.freeze([...cfg.languages]);
    const getter = (proto, name, make) => { const d = Object.getOwnPropertyDescriptor(proto, name); if (!d || !d.get) return; Object.defineProperty(proto, name, { ...d, get: makeGetter(name, d.get, make(d.get)) }); };
    const method = (proto, name, make) => { const d = Object.getOwnPropertyDescriptor(proto, name); if (!d || typeof d.value !== 'function') return; Object.defineProperty(proto, name, { ...d, value: makeMethod(name, d.value, make(d.value)) }); };
    if (window.NavigatorUAData) {
      const P = NavigatorUAData.prototype;
      getter(P, 'brands', () => function () { return brands; });
      method(P, 'toJSON', original => function () { const json = apply(original, this, []); return { ...json, brands: copyBrands() }; });
      method(P, 'getHighEntropyValues', original => function (hints) {
        return apply(then, apply(original, this, [hints]), [values => {
          const out = { ...values };
          if ('brands' in out) out.brands = copyBrands();
          if (isArray(values.fullVersionList)) {
            const chromium = apply(find, values.fullVersionList, [item => item.brand === 'Chromium']), grease = apply(find, values.fullVersionList, [item => item.brand !== 'Chromium' && item.brand !== 'Google Chrome']);
            out.fullVersionList = apply(map, brands, [item => item.brand === 'Chromium' || item.brand === 'Google Chrome' ? { brand: item.brand, version: chromium ? chromium.version : item.version } : { brand: item.brand, version: grease ? grease.version : item.version + '.0.0.0' }]);
          }
          return out;
        }]);
      });
    }
    getter(Navigator.prototype, 'languages', () => function () { return languages; });
    getter(Navigator.prototype, 'language', () => function () { return languages[0]; });
    // window.chrome: Chromium's browser layer gives every web page { loadTimes, csi, app } (in that order, all plain writable data properties);
    // Electron's engine gives an empty object, which is what marks "claims to be Chrome, is an embedded runtime". Chrome's own shape, from a
    // real Chrome 156 page: loadTimes() and csi() are anonymous constructible native functions, app.* are native methods, chrome.runtime is absent.
    try {
      const defineData = (object, key, value) => Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
      let chromeObject = window.chrome;
      if (!chromeObject || typeof chromeObject !== 'object') { chromeObject = {}; defineData(window, 'chrome', chromeObject); }
      const entry = () => { try { return performance.getEntriesByType('navigation')[0] || null; } catch { return null; } };
      const origin = () => { try { return performance.timeOrigin; } catch { return Date.now(); } };
      const seconds = ms => ms > 0 ? (origin() + ms) / 1000 : 0;
      const defer = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : fn => Promise.resolve().then(fn);
      const nativeMethod = (name, impl) => mark(({ [name](...args) { return impl(args); } })[name], 'function ' + name + '() { [native code] }');
      const anonymous = (fn, length) => mark(sameLength(Object.defineProperty(fn, 'name', { value: '', configurable: true }), length), 'function () { [native code] }');
      if (Object.isExtensible(chromeObject) && !('loadTimes' in chromeObject)) {
        defineData(chromeObject, 'loadTimes', anonymous(function () {
          const nav = entry(), protocol = nav && typeof nav.nextHopProtocol === 'string' ? nav.nextHopProtocol : '', negotiated = Boolean(protocol) && location.protocol === 'https:';
          const paint = (() => { try { return performance.getEntriesByName('first-paint')[0] || null; } catch { return null; } })();
          return {
            requestTime: origin() / 1000, startLoadTime: (origin() + (nav ? nav.fetchStart : 0)) / 1000, commitLoadTime: seconds(nav ? nav.responseStart : 0),
            finishDocumentLoadTime: seconds(nav ? nav.domContentLoadedEventEnd : 0), finishLoadTime: seconds(nav ? nav.loadEventEnd : 0), firstPaintTime: seconds(paint ? paint.startTime : 0), firstPaintAfterLoadTime: 0,
            navigationType: nav && { reload: 'Reload', back_forward: 'BackForward' }[nav.type] || 'Other', wasFetchedViaSpdy: /^h[23]/.test(protocol), wasNpnNegotiated: negotiated,
            npnNegotiatedProtocol: negotiated ? protocol : 'unknown', wasAlternateProtocolAvailable: false, connectionInfo: protocol || 'http/1.1'
          };
        }, 0));
      }
      if (Object.isExtensible(chromeObject) && !('csi' in chromeObject)) {
        defineData(chromeObject, 'csi', anonymous(function () {
          const nav = entry(), start = origin();
          return { startE: Math.round(start), onloadT: nav && nav.loadEventEnd > 0 ? Math.round(start + nav.loadEventEnd) : 0, pageT: Date.now() - start, tran: 15 };
        }, 0));
      }
      if (Object.isExtensible(chromeObject) && !('app' in chromeObject)) {
        const app = {};
        defineData(app, 'isInstalled', false);
        defineData(app, 'getDetails', nativeMethod('getDetails', args => { if (args.length) throw new Error('Error in invocation of app.getDetails(): '); return null; }));
        defineData(app, 'getIsInstalled', nativeMethod('getIsInstalled', () => false));
        defineData(app, 'installState', nativeMethod('installState', args => { const callback = args[0]; if (typeof callback === 'function') defer(() => callback('not_installed'), 0); }));
        defineData(app, 'runningState', nativeMethod('runningState', () => 'cannot_run'));
        defineData(app, 'InstallState', { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' });
        defineData(app, 'RunningState', { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' });
        defineData(chromeObject, 'app', app);
      }
    } catch (error) { /* The brands and languages above are already in place. */ }
  } catch (error) { /* A page must never break because the identity could not be applied. */ }
}
let current;
const torIdentity = () => current ||= createIdentity(process.versions.chrome);
module.exports = { torIdentity, createIdentity, brandList, header, rewriteHeaders, sendHeaders, pageLanguages, scriptFor, inject, PRODUCT };
