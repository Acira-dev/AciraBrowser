'use strict';
// A typed address that got https by default (resolveNavigation's httpsFirst). When the secure connection cannot be made at all, the page
// must not open over http by itself: someone on the network who blocks port 443 would land the person on a plain http sign-in page.
// The error page asks first ("Continue over http"); only a site this profile already chose to open over http goes straight there.
// With strict HTTPS-only mode on (https-only.cjs), which asks every time, the page asks even for a site the profile chose, its answer is strict mode's
// per-tab exception (grantHTTP) rather than a second question, and nothing is kept. Forget site drops the kept choice (forget-site.cjs).
/** Chromium's "could not connect securely" errors: closed port, reset, timeout, TLS failure. Certificate errors and unknown hosts have their own pages. */
const FALLBACK_CODES = Object.freeze([-100, -101, -102, -103, -104, -107, -113, -118, -324]);
/** The policy row the choice is kept in: the site's http origin, the key per-site choices already use. */
const siteKey = host => 'http://' + String(host).toLowerCase();
/** Private windows, private and Tor tabs and private profiles never keep the choice, so they ask every time. */
const remembers = (tab, { privateMode = false, torMode = false, profile } = {}) => !privateMode && !torMode && !tab?.privacy && !profile?.private && !String(tab?.browserProfileId || '').startsWith('private-');
/** The host (with port) of an https address, or null. */
function hostOf(url) { try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.host : null; } catch { return null; } }
/** The Chromium error number at the end of a tab's error text ("ERR_CONNECTION_REFUSED (-102)"), or null. */
function errorCode(error) { const match = /\((-\d+)\)\s*$/.exec(String(error || '')); return match ? Number(match[1]) : null; }
const allowed = (database, profileId, host) => { try { return database?.policy(profileId, siteKey(host))?.httpFallback === true; } catch { return false; } };
const remember = (database, profileId, host) => { try { database.setPolicy(profileId, siteKey(host), { ...(database.policy(profileId, siteKey(host)) || {}), httpFallback: true }); return true; } catch { return false; } };
/** The tab is on the "no secure connection" page of a typed address: the only page that may offer http. */
const offered = tab => Boolean(tab && tab.contentKind === 'web' && tab.httpsFirst && tab.error && hostOf(tab.url) && FALLBACK_CODES.includes(errorCode(tab.error)));
module.exports = { FALLBACK_CODES, siteKey, remembers, hostOf, errorCode, allowed, remember, offered };
