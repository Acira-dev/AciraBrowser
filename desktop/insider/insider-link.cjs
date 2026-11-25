'use strict';
// Beta 14 rule 4: the personal one-click link acira://insider/activate?t=<token> (one use; the token is 32 random characters). It reaches Acira three ways, and every one ends in
// the SAME place: the confirmation sheet ("Activate Insider on this profile?", Activate / Not now). NOTHING ACTIVATES WITHOUT THAT TAP: a web page can open the link, so opening it
// only ever shows the question.
//  1. From the operating system (a click in a chat app or another browser): macOS hands it over with 'open-url', Windows and Linux start Acira (or a second instance) with the link
//     in the command line. createInsiderLinkIntake below takes those, before app ready, and keeps them until main can show the sheet.
//  2. From a page inside Acira (a click on the link in a web chat): main's external-protocol path (desktop/main.cjs externalProtocol) hands it here instead of refusing the scheme.
//  3. Pasted into "Enter Insider code" (insider-code.cjs parseEntry) when the link cannot be opened.
// Strict on purpose: the scheme acira, the host insider, the path /activate, ONE parameter t, the token's shape. Anything else is not this link and is ignored.
// Beta 14.5 (the team's row 11): a member's INVITE can travel the same way, acira://insider/invite?c=<code> (the code as the invite screen shows it, ACIRA-XXXX-XXXX): from the system, from a page inside Acira, or
// pasted into "Enter Insider code". Same strictness (host insider, path /invite, ONE parameter c, the code's shape), the same end (the confirmation sheet, nothing redeemed without the tap), and a profile that is
// already a member never opens it (main says so calmly). The code is the friend's own to redeem: the link carries nothing else.
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const INVITE_CODE = /^ACIRA-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const MAX_LINK = 512;

/** The strict shape shared by both links: {kind:'activate', token} | {kind:'invite', code} | null. */
function parseLink(text) {
  if (typeof text !== 'string' || !text.length || text.length > MAX_LINK || /[\u0000- \u007f]/.test(text.trim())) return null;
  let url;
  try { url = new URL(text.trim()); } catch { return null; }
  if (url.protocol !== 'acira:' || url.hostname.toLowerCase() !== 'insider' || url.username || url.password || url.port || url.hash) return null;
  const names = [...url.searchParams.keys()];
  if (names.length !== 1) return null;
  if (url.pathname === '/activate' && names[0] === 't') { const token = url.searchParams.get('t'); return TOKEN.test(token) ? { kind: 'activate', token } : null; }
  if (url.pathname === '/invite' && names[0] === 'c') { const code = url.searchParams.get('c'); return INVITE_CODE.test(code) ? { kind: 'invite', code } : null; }
  return null;
}
/** The token of an activation link, or null. */
function parseInsiderLink(text) { const link = parseLink(text); return link?.kind === 'activate' ? link.token : null; }
/** The code of an invite link, or null. */
function parseInviteLink(text) { const link = parseLink(text); return link?.kind === 'invite' ? link.code : null; }
/** The first activation link in a command line (Windows and Linux pass the link as an argument), or null. */
function tokenFromArgv(argv) {
  for (const argument of Array.isArray(argv) ? argv : []) { const token = parseInsiderLink(argument); if (token) return token; }
  return null;
}
/** The first Insider link of either kind in a command line: {kind, token|code} or null. */
function linkFromArgv(argv) {
  for (const argument of Array.isArray(argv) ? argv : []) { const link = parseLink(argument); if (link) return link; }
  return null;
}

/**
 * Takes activation links from the operating system before app ready (Electron wants 'open-url' registered early) and keeps the LAST one until `bind(handler)`; later links go to the
 * handler at once. One pending link at most: a person who clicks twice sees one sheet, and a page that fires many links cannot queue a pile of sheets. The ordinary link intake
 * (accounts/external-links.cjs) takes only http(s), so the two never take the same link.
 */
function createInsiderLinkIntake({ app, argv = process.argv, onError = () => {} }) {
  let handler = null, pending = linkFromArgv(argv);
  // the handler gets (token, 'activate') for a personal link and (code, 'invite') for a member's invite link
  const deliver = (link) => {
    if (!link) return false;
    if (!handler) { pending = link; return true; }
    try { const result = handler(link.kind === 'invite' ? link.code : link.token, link.kind); if (result && typeof result.catch === 'function') result.catch(() => { try { onError('The Insider link could not be shown.'); } catch { /* nothing to tell */ } }); } catch { try { onError('The Insider link could not be shown.'); } catch { /* nothing to tell */ } }
    return true;
  };
  const openUrl = (event, url) => { const link = parseLink(url); if (link) { try { event.preventDefault(); } catch { /* not cancellable */ } deliver(link); } };
  const secondInstance = (_event, args) => { deliver(linkFromArgv(args)); };
  app.on('open-url', openUrl);
  app.on('second-instance', secondInstance);
  return {
    /** Main can show the sheet now: the link that waited (if any) goes first. */
    bind(fn) { if (typeof fn !== 'function') throw new TypeError('An Insider link handler is required.'); handler = fn; const waiting = pending; pending = null; if (waiting) deliver(waiting); },
    /** A link from a page inside Acira (main's external-protocol path). Returns whether it was an activation link. */
    take(url) { return deliver(parseLink(url)); },
    get pending() { return pending !== null; },
    dispose() { handler = null; pending = null; app.removeListener('open-url', openUrl); app.removeListener('second-instance', secondInstance); },
  };
}

module.exports = { parseInsiderLink, parseInviteLink, parseLink, tokenFromArgv, linkFromArgv, createInsiderLinkIntake, TOKEN, INVITE_CODE };
