'use strict';
// Pairing an extension's chrome.downloads.download() with the download Electron reports for it (13.8).
//
// Chromium ties the two together by a callback on the request itself (downloads_api.cc: DownloadsDownloadFunction sets
// DownloadUrlParameters::set_callback). Electron's session.downloadURL() has no callback: the manager only announces `will-download`
// with the item's own URL, so the engine (download-engine.cjs) has to recognise which pending request an item belongs to by its address.
//
// Until 13.7 that was plain string equality between `new URL(url).href` and the item's URL. The item's address is Chromium's GURL spec, and
// the two writers do not always agree: GURL percent-encodes `|` and `^` in a path (url/url_canon_path.cc kPathCharLookup) where Node's URL
// of the day may leave one of them as it is (Electron 44 leaves `|`). A download of such an address was never claimed, was cancelled
// as a stray, and the extension saw NETWORK_FAILED after the 60 s limit. This file compares the way Chromium writes an address.
//
// The path rules below are a port of url/url_canon_path.cc (Chromium 152, BSD-3-Clause, Copyright 2013 The Chromium Authors): the characters
// its kPathCharLookup marks ESCAPE, a valid %XX kept exactly, a stray % passed through, UTF-8 for everything above 0x7f. When even that is not
// enough (an address a later Chromium writes in a way not seen yet), the addresses are compared with every escape decoded, and last of all by
// origin, oldest request first.

/** url/url_canon_path.cc kPathCharLookup: the ASCII characters (besides '%') that are escaped in a path. */
const PATH_ESCAPE = new Set([' ', '"', '#', '<', '>', '?', '\\', '^', '`', '{', '|', '}', '\u007f']);
const isEscapedByte = code => code <= 0x20 || code >= 0x7f || PATH_ESCAPE.has(String.fromCharCode(code));
const HEX = /^[0-9a-fA-F]{2}$/;

/** AppendEscapedChar over the UTF-8 bytes of one character: "%7C". */
function escapeChar(character) {
  let out = '';
  for (const byte of Buffer.from(character, 'utf8')) out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  return out;
}

/** DoPartialPathInternal for an already-parsed path: a valid %XX stays, a stray % stays, an ESCAPE character becomes %XX. */
function canonicalPath(pathname) {
  let out = '';
  const chars = Array.from(pathname);
  for (let i = 0; i < chars.length; i++) {
    const character = chars[i];
    if (character === '%') { out += '%'; continue; } // a valid escape is copied as it is, an invalid one passes through unchanged
    const code = character.codePointAt(0);
    out += code <= 0x7f ? (isEscapedByte(code) ? escapeChar(character) : character) : escapeChar(character);
  }
  return out;
}

/** The address as Chromium writes it, or null for something that is not an address. Standard (hierarchical) schemes get the path rules; the rest keep Node's form. */
function canonicalUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { return null; }
  if (['http:', 'https:', 'ftp:', 'ws:', 'wss:'].includes(url.protocol)) { url.pathname = canonicalPath(url.pathname); url.hash = ''; return url.href; }
  return url.href;
}

/** Every %XX decoded (hex case and encoding no longer matter): for the case where two spellings of one address are left. */
function decodeEscapes(text) {
  return String(text).replace(/(?:%[0-9a-fA-F]{2})+/g, run => { try { return decodeURIComponent(run); } catch { return run.toLowerCase(); } });
}
function looseUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { return null; }
  if (['http:', 'https:', 'ftp:', 'ws:', 'wss:'].includes(url.protocol)) return url.protocol + '//' + url.host + decodeEscapes(url.pathname) + decodeEscapes(url.search);
  return decodeEscapes(url.href);
}
/** Where an address lives: scheme, host and port for the web, the scheme alone for data: and blob:. */
function originOf(value) {
  try { const url = new URL(String(value)); return ['http:', 'https:', 'ftp:', 'ws:', 'wss:'].includes(url.protocol) ? url.protocol + '//' + url.host : url.protocol; } catch { return null; }
}

/** What a pending request remembers about its address. */
function keysOf(href) { return {exact: href, canonical: canonicalUrl(href), loose: looseUrl(href), origin: originOf(href)}; }

/**
 * Which pending request is this item? `queue` is the requests in the order they were made, each {href, keys?}; `urls` is the item's address
 * (the first of its chain, the last, and the current one). The oldest request that fits wins at each step:
 *   1. the same string; 2. the same address written the way Chromium writes it; 3. the same address with every escape decoded;
 *   4. the same origin (a request's address no writer agrees on: say a data: URL of megabytes).
 * Returns the index in `queue`, or -1.
 */
function indexOf(queue, urls) {
  const wanted = urls.filter(url => typeof url === 'string' && url);
  if (!queue.length || !wanted.length) return -1;
  const keys = entry => entry.keys || (entry.keys = keysOf(entry.href));
  const steps = [
    entry => wanted.includes(keys(entry).exact),
    entry => { const own = keys(entry).canonical; return !!own && wanted.some(url => canonicalUrl(url) === own); },
    entry => { const own = keys(entry).loose; return !!own && wanted.some(url => looseUrl(url) === own); },
    entry => { const own = keys(entry).origin; return !!own && wanted.some(url => originOf(url) === own); }
  ];
  for (const step of steps) { const at = queue.findIndex(step); if (at >= 0) return at; }
  return -1;
}

module.exports = {PATH_ESCAPE, canonicalPath, canonicalUrl, looseUrl, originOf, keysOf, indexOf};
