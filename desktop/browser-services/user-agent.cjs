'use strict';
// Keep Chromium's compatible/reduced UA and identify the browser accurately.
// The framework token is implementation detail; the Acira product token must not
// be removed to impersonate Chrome, especially on accounts.google.com.
const APP_VERSION = require('../../package.json').version;
const APP_TOKENS = /\s(?:AciraBrowser|acira-browser|Electron)\/\S+/g;
function chromeUserAgent(userAgent, version = APP_VERSION) {
  if (typeof userAgent !== 'string' || !userAgent.includes('Chrome/')) return userAgent;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new TypeError('A valid Acira version is required.');
  return userAgent.replace(APP_TOKENS, '').replace(/Chrome\/(\d+)\.\d+\.\d+\.\d+/, 'Chrome/$1.0.0.0') + ' AciraBrowser/' + version;
}
/** Sets the application-wide fallback user agent before any session exists. `ACIRA_KEEP_ELECTRON_UA=1` keeps Electron's own (for comparisons). */
function applyChromeUserAgent(app, env = process.env) {
  if (env.ACIRA_KEEP_ELECTRON_UA === '1') return app.userAgentFallback;
  app.userAgentFallback = chromeUserAgent(app.userAgentFallback);
  return app.userAgentFallback;
}
/** Tor sessions never carry the product token: a version in the user agent would single Tor users out from everyone else on Tor. Call before the session's first page. */
function torUserAgent(userAgent) { return typeof userAgent === 'string' ? userAgent.replace(APP_TOKENS, '') : userAgent; }
function applyTorUserAgent(session) { const current = session.getUserAgent(), clean = torUserAgent(current); if (clean !== current) session.setUserAgent(clean); }
module.exports = { chromeUserAgent, applyChromeUserAgent, torUserAgent, applyTorUserAgent };
