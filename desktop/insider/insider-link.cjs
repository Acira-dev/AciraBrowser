'use strict';
// Beta 14 rule 4: the personal one-click link acira://insider/activate?t=<token> (one use; the token is 32 random characters). It reaches Acira three ways, and every one ends in
// the SAME place: the confirmation sheet ("Activate Insider on this profile?", Activate / Not now). NOTHING ACTIVATES WITHOUT THAT TAP: a web page can open the link, so opening it
// only ever shows the question.
//  1. From the operating system (a click in a chat app or another browser): macOS hands it over with 'open-url', Windows and Linux start Acira (or a second instance) with the link
//     in the command line. createInsiderLinkIntake below takes those, before app ready, and keeps them until main can show the sheet.
//  2. From a page inside Acira (a click on the link in a web chat): main's external-protocol path (desktop/main.cjs externalProtocol) hands it here instead of refusing the scheme.
//  3. Pasted into "Enter Insider code" (insider-code.cjs parseEntry) when the link cannot be opened.
// Strict on purpose: the scheme acira, the host insider, the path /activate, ONE parameter t, the token's shape. Anything else is not this link and is ignored.
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const MAX_LINK = 512;

/** The token of an activation link, or null. */
function parseInsiderLink(text) {
  if (typeof text !== 'string' || !text.length || text.length > MAX_LINK || /[\u0000- \u007f]/.test(text.trim())) return null;
  let url;
  try { url = new URL(text.trim()); } catch { return null; }
  if (url.protocol !== 'acira:' || url.hostname.toLowerCase() !== 'insider' || url.pathname !== '/activate' || url.username || url.password || url.port || url.hash) return null;
  const names = [...url.searchParams.keys()];
  if (names.length !== 1 || names[0] !== 't') return null;
  const token = url.searchParams.get('t');
  return TOKEN.test(token) ? token : null;
}
/** The first activation link in a command line (Windows and Linux pass the link as an argument), or null. */
function tokenFromArgv(argv) {
  for (const argument of Array.isArray(argv) ? argv : []) { const token = parseInsiderLink(argument); if (token) return token; }
  return null;
}

/**
 * Takes activation links from the operating system before app ready (Electron wants 'open-url' registered early) and keeps the LAST one until `bind(handler)`; later links go to the
 * handler at once. One pending link at most: a person who clicks twice sees one sheet, and a page that fires many links cannot queue a pile of sheets. The ordinary link intake
 * (accounts/external-links.cjs) takes only http(s), so the two never take the same link.
 */
function createInsiderLinkIntake({ app, argv = process.argv, onError = () => {} }) {
  let handler = null, pending = tokenFromArgv(argv);
  const deliver = (token) => {
    if (!token) return false;
    if (!handler) { pending = token; return true; }
    try { const result = handler(token); if (result && typeof result.catch === 'function') result.catch(() => { try { onError('The Insider link could not be shown.'); } catch { /* nothing to tell */ } }); } catch { try { onError('The Insider link could not be shown.'); } catch { /* nothing to tell */ } }
    return true;
  };
  const openUrl = (event, url) => { if (parseInsiderLink(url)) { try { event.preventDefault(); } catch { /* not cancellable */ } deliver(parseInsiderLink(url)); } };
  const secondInstance = (_event, args) => { deliver(tokenFromArgv(args)); };
  app.on('open-url', openUrl);
  app.on('second-instance', secondInstance);
  return {
    /** Main can show the sheet now: the link that waited (if any) goes first. */
    bind(fn) { if (typeof fn !== 'function') throw new TypeError('An Insider link handler is required.'); handler = fn; const waiting = pending; pending = null; if (waiting) deliver(waiting); },
    /** A link from a page inside Acira (main's external-protocol path). Returns whether it was an activation link. */
    take(url) { return deliver(parseInsiderLink(url)); },
    get pending() { return pending !== null; },
    dispose() { handler = null; pending = null; app.removeListener('open-url', openUrl); app.removeListener('second-instance', secondInstance); },
  };
}

module.exports = { parseInsiderLink, tokenFromArgv, createInsiderLinkIntake, TOKEN };
