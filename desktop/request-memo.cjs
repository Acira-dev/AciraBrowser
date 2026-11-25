'use strict';
// 14.5 (battery, content blocking's per-request churn in main): the same few strings were parsed again for every request of a page. A page's own address was parsed twice a
// request (is protection on for this site, is it off), the request's host once more for the pipeline's record, and the cosmetic filter's message was written out as JSON
// just to see how long it is. These are the memoised forms; each answers exactly what the plain call answered.
// Keep this file ASCII only (main's script text stays one byte per character).
const MAX_ORIGINS = 64, MAX_HOSTS = 256;
const origins = new Map(), hosts = new Map();
/** A small least-recently-used cache: a hit moves the key to the end; a miss makes the value and drops the oldest key past `max`. */
function remembered(map, key, max, make) {
  if (map.has(key)) { const value = map.get(key); map.delete(key); map.set(key, value); return value; }
  const value = make(key);
  if (map.size >= max) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
}
/** `new URL(value).origin`, or null when it is not an address; a page's address is parsed once, not once per request. */
function originOf(value) {
  if (typeof value !== 'string') { try { return new URL(value).origin; } catch { return null; } }
  return remembered(origins, value, MAX_ORIGINS, address => { try { return new URL(address).origin; } catch { return null; } });
}
const AUTHORITY = /^(?:https?|wss?):\/\/([A-Za-z0-9.:\-\[\]]*)/i;
/** `new URL(url).hostname.slice(0, 253)`, or '' when it is not an address. A web address is looked up by its authority (the part between // and the first / ? or #), which
 * repeats from request to request; anything else (a user name, an odd character, another scheme) is parsed as before. */
function hostnameOf(url) {
  if (typeof url !== 'string') { try { return new URL(url).hostname.slice(0, 253); } catch { return ''; } }
  const found = AUTHORITY.exec(url);
  if (found) {
    const after = url.charAt(found[0].length);
    if (after === '' || after === '/' || after === '?' || after === '#') {
      return remembered(hosts, found[1], MAX_HOSTS, authority => { try { return new URL('http://' + authority).hostname.slice(0, 253); } catch { return ''; } });
    }
  }
  try { return new URL(url).hostname.slice(0, 253); } catch { return ''; }
}
/** Whether `JSON.stringify(value).length` would pass `limit`, estimated without writing the JSON (a string costs its length and three, a key its length and four). */
function tooLarge(value, limit = 100000) {
  let total = 0;
  const add = (item) => {
    if (total > limit) return;
    if (typeof item === 'string') { total += item.length + 3; return; }
    if (Array.isArray(item)) { total += 2; for (const entry of item) { add(entry); if (total > limit) return; total += 1; } return; }
    if (item && typeof item === 'object') { total += 2; for (const key of Object.keys(item)) { total += key.length + 4; add(item[key]); if (total > limit) return; } return; }
    total += String(item).length;
  };
  add(value);
  return total > limit;
}
module.exports = { originOf, hostnameOf, tooLarge };
