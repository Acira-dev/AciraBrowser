'use strict';
// Legacy filename, now language preferences only. Browser brands, Client Hints
// and NavigatorUAData remain native in pages, frames and every kind of worker.
const { nativeAuthenticationContext } = require('./authentication-compatibility.cjs');

// Chromium sends Sec-CH-UA, Sec-CH-UA-Mobile and Sec-CH-UA-Platform on every request to a secure origin, but Electron leaves them off navigations,
// iframes and worker scripts, so a document's headers disagreed with its own navigator.userAgentData. A page request missing them gets the engine's
// own values here (the list follows Chromium's GenerateBrandVersionList for two brands; tests/user-agent.test.cjs compares it with the real engine).
const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'], GREASE_VERSIONS = ['8', '99', '24'];
const PLATFORM_NAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
const SECURE_URL = /^(?:https:|http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$))/i;
function nativeBrands(version) {
  const major = Number.parseInt(String(version).split('.')[0], 10);
  if (!Number.isSafeInteger(major) || major < 1) throw Error('A Chromium version is required.');
  const grease = `"Not${GREASE_CHARS[major % 11]}A${GREASE_CHARS[(major + 1) % 11]}Brand";v="${GREASE_VERSIONS[major % 3]}"`, chromium = `"Chromium";v="${major}"`;
  return (major % 2 ? [chromium, grease] : [grease, chromium]).join(', ');
}
function addNativeHints(details, version = process.versions.chrome, platform = process.platform) {
  const headers = details.requestHeaders || {}, names = Object.keys(headers).map(name => name.toLowerCase());
  const destination = String(Object.entries(headers).find(([name]) => name.toLowerCase() === 'sec-fetch-dest')?.[1] || '').toLowerCase();
  const pageRequest = Boolean(details.webContents || details.webContentsId) || ['mainFrame', 'subFrame', 'worker', 'sharedWorker', 'serviceWorker'].includes(details.resourceType)
    || ['document', 'iframe', 'frame', 'worker', 'sharedworker', 'serviceworker'].includes(destination);
  if (!pageRequest || !SECURE_URL.test(String(details.url || '')) || !PLATFORM_NAMES[platform]) return {};
  const add = {};
  if (!names.includes('sec-ch-ua')) add['Sec-CH-UA'] = nativeBrands(version);
  if (!names.includes('sec-ch-ua-mobile')) add['Sec-CH-UA-Mobile'] = '?0';
  if (!names.includes('sec-ch-ua-platform')) add['Sec-CH-UA-Platform'] = `"${PLATFORM_NAMES[platform]}"`;
  return Object.keys(add).length ? { requestHeaders: { ...headers, ...add } } : {};
}

function pageLanguages(effective) {
  const list = Array.isArray(effective) ? effective.filter(tag => typeof tag === 'string' && tag) : [];
  return list.length ? list.slice(0, 8) : ['en-US'];
}

function scriptFor(languages, { topUrl = '', frameUrl = topUrl, allowNativeAuthentication = true } = {}) {
  if (allowNativeAuthentication && nativeAuthenticationContext(topUrl, frameUrl)) return '';
  return '(' + inject.toString() + ')(' + JSON.stringify(pageLanguages(languages)) + ');';
}

// The existing per-profile website-language preference is retained outside
// authentication pages. No UAData or Function.prototype.toString replacement.
function inject(languages) {
  'use strict';
  try {
    const values = Object.freeze([...languages]);
    for (const [name, value] of [['languages', values], ['language', values[0]]]) {
      const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, name);
      if (descriptor?.get) Object.defineProperty(Navigator.prototype, name, { ...descriptor, get: () => value });
    }
  } catch { /* A website must remain usable if the preference cannot be applied. */ }
}

module.exports = { pageLanguages, scriptFor, inject, nativeBrands, addNativeHints };
