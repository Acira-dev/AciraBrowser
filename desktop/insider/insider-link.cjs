'use strict';
// The personal Insider link acira://insider/activate?t=<token> (one use; the token is 32 random characters). 13.11 only reads the token out of text a person types or pastes into
// "Insider code" (insider-code.cjs): this build does not take the link from the operating system or from a web page, so nothing here opens or starts anything.
// Strict on purpose: the scheme acira, the host insider, the path /activate, ONE parameter t, the token's shape. Anything else is not this link.
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

module.exports = { parseInsiderLink, TOKEN };
