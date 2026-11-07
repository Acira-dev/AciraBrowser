'use strict';
// A few sites read the LAST product token of the user agent and refuse every browser they do not know by name. WhatsApp Web is one: the string Acira
// sends everywhere ("... Safari/537.36 AciraBrowser/<version>", user-agent.cjs) gets "WhatsApp works with Google Chrome 100+ / Update Google Chrome"
// from the server at the very first request, before any script runs. The same string without the last token, or with Edg/ or OPR/ (the two it knows),
// gets the app (GitHub issue 3, 7 Nov 2026). Chrome itself, Brave and Vivaldi send no extra token, which is why they never meet this.
//
// Acira keeps its honest token everywhere else. For the hosts listed here only, requests and the tab's own navigator.userAgent use the same Chromium
// string without the Acira (and framework) token. Nothing is invented: the client hints (Sec-CH-UA, navigator.userAgentData) stay the engine's own,
// and the tab goes back to the ordinary string the moment it navigates to any other site. Tor sessions never reach this (they carry no token at all).
// Add a host only after seeing the same server-side refusal for the token alone (same request, with and without it).
//
// Two layers, because neither alone is enough:
//  - the request header (sendHeaders, in the session's request pipeline): the wire is right for pages, workers and sockets alike, whatever the tab does;
//  - the tab's own user agent (webContents.setUserAgent): navigator.userAgent agrees with the wire. It must be changed when a navigation STARTS: set later,
//    from the header hook, a navigation that swaps renderer process commits its new document with the old string (seen leaving WhatsApp for another
//    site: header with the Acira token, navigator.userAgent without it). So a tab that has met a listed host follows its own main-frame navigations.
const { torUserAgent: withoutProductToken } = require('./user-agent.cjs');

const TOKEN_INTOLERANT_HOSTS = Object.freeze(['web.whatsapp.com']);

function tokenIntolerantUrl(url) {
  if (typeof url !== 'string' || !TOKEN_INTOLERANT_HOSTS.some(host => url.includes(host))) return false; // the common request never pays for a URL parse
  try { const parsed = new URL(url); return (parsed.protocol === 'https:' || parsed.protocol === 'wss:') && TOKEN_INTOLERANT_HOSTS.includes(parsed.hostname); } catch { return false; }
}

const plainTabs = new WeakSet(); // tabs whose own user agent is the token-free string right now
const followed = new WeakSet(); // tabs already following their main-frame navigations

const usable = contents => Boolean(contents) && !(typeof contents.isDestroyed === 'function' && contents.isDestroyed());
function contentsFor(details) {
  if (details.webContents) return details.webContents;
  if (!details.webContentsId) return null;
  try { return require('electron').webContents.fromId(details.webContentsId) || null; } catch { return null; }
}

/** The tab's own user agent becomes (plain) or stops being (not plain) the token-free string. A failure leaves the header layer, which is enough for the page to load. */
function setTabUserAgent(contents, plain) {
  if (plain === plainTabs.has(contents)) return;
  try {
    const ordinary = contents.session.getUserAgent();
    contents.setUserAgent(plain ? withoutProductToken(ordinary) : ordinary);
    if (plain) plainTabs.add(contents); else plainTabs.delete(contents);
  } catch { /* an older engine or a closing tab */ }
}

/** From the first listed main-frame request on, this tab puts the right string in place as each of its main-frame navigations (and redirects) starts. */
function follow(contents) {
  if (followed.has(contents) || typeof contents.on !== 'function') return;
  followed.add(contents);
  const navigation = details => { if (details && details.isMainFrame && !details.isSameDocument && usable(contents)) setTabUserAgent(contents, tokenIntolerantUrl(details.url)); };
  contents.on('did-start-navigation', navigation);
  contents.on('did-redirect-navigation', navigation);
}

/**
 * Request-header hook for ordinary (non-Tor) sessions, after chrome-identity.cjs has added the hints a page request lacked.
 * A request to a listed host gets the token-free User-Agent; a top-level navigation to one also starts the tab following itself (above).
 * A top-level navigation from such a tab to anything else is sent with the session's own string: Chromium builds a navigation's headers when it is
 * created, BEFORE 'did-start-navigation' lets the tab change its string, so that request still carries the token-free one.
 */
function sendHeaders(details, session, contentsOf = contentsFor) {
  const headers = details && details.requestHeaders;
  if (!headers) return {};
  const mainFrame = details.resourceType === 'mainFrame', listed = tokenIntolerantUrl(details.url);
  if (!listed && !mainFrame) return {};
  const key = Object.keys(headers).find(name => name.toLowerCase() === 'user-agent');
  if (!key) return {};
  const contents = mainFrame ? contentsOf(details) : null;
  if (listed) {
    if (usable(contents)) { follow(contents); setTabUserAgent(contents, true); }
    const plain = withoutProductToken(headers[key]);
    return plain !== headers[key] ? { requestHeaders: { ...headers, [key]: plain } } : {};
  }
  if (!usable(contents) || !followed.has(contents)) return {}; // a tab that never met a listed host: nothing of ours is in play
  setTabUserAgent(contents, false); // in case the navigation event was missed
  let own = '';
  try { own = session.getUserAgent(); } catch { return {}; }
  return typeof own === 'string' && own && own !== headers[key] && withoutProductToken(own) === headers[key] ? { requestHeaders: { ...headers, [key]: own } } : {};
}

module.exports = { TOKEN_INTOLERANT_HOSTS, tokenIntolerantUrl, sendHeaders };
