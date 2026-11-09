'use strict';
// What reg.exe prints for a path with a letter outside ASCII (C:\Users\José, C:\Users\Müller, C:\Users\محمد).
// reg.exe writes the text of `reg query` in the console's OEM code page (437, 850, 720, 862 ...) when its output goes to a pipe, and Node reads it as UTF-8, so
// each such letter arrives as U+FFFD, as "?" (a letter the code page has none for), as a look-alike ASCII letter (best fit: ł becomes l) or, for two bytes that
// happen to form a valid UTF-8 letter, as one other letter. The text can not be decoded back, but the ASCII parts of it are exact, and Acira knows the paths it
// expects: the folder of its own program, the user's profile folder. These helpers compare and repair a registry string against those known paths.
// Only the letters outside ASCII are loose; every ASCII character, every separator and the number of path parts must still agree.

const NON_ASCII = /[^\x00-\x7f]/;
const hasNonAscii = text => NON_ASCII.test(String(text));

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A garbled letter: anything but a path separator, a drive colon or a character no file name has.
const ANY_LETTER = '[^\\\\/:"<>|\\r\\n]';

/** A RegExp source that matches `expected` as reg.exe's output may show it: ASCII exact, each run of k non-ASCII letters as 1 to 2k other characters of a name. */
function garbledSource(expected) {
  const chars = [...String(expected)];
  let out = '';
  for (let at = 0; at < chars.length;) {
    if (chars[at].codePointAt(0) < 128) { out += escapeRegExp(chars[at]); at++; continue; }
    let run = 0;
    while (at + run < chars.length && chars[at + run].codePointAt(0) >= 128) run++;
    out += `${ANY_LETTER}{1,${run * 2}}`;
    at += run;
  }
  return out;
}

/** True when `actual` (as reg.exe printed it) can be `expected`. Only asked when `expected` has a non-ASCII letter; otherwise the two must simply be equal. */
function sameAsGarbled(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  if (actual === expected) return true;
  if (!hasNonAscii(expected)) return false;
  try { return new RegExp('^' + garbledSource(expected) + '$', 'i').test(actual); } catch { return false; }
}

/**
 * `text` with a leading known folder put back: when it starts with `root` as reg.exe may have printed it (and the root is followed by a separator or ends there),
 * the real `root` replaces that start. The roots are tried longest first. Text with no non-ASCII letter, and text no root explains, comes back as it was.
 */
function repairPath(text, roots) {
  if (typeof text !== 'string' || !hasNonAscii(text) && !text.includes('?')) return text;
  const candidates = [...new Set((roots || []).filter(root => typeof root === 'string' && root && hasNonAscii(root)))].sort((a, b) => b.length - a.length);
  for (const root of candidates) {
    let match;
    try { match = new RegExp('^' + garbledSource(root.replace(/[\\/]+$/, '')) + '(?=[\\\\/]|$)', 'i').exec(text); } catch { continue; }
    if (match) return root.replace(/[\\/]+$/, '') + text.slice(match[0].length);
  }
  return text;
}

module.exports = { hasNonAscii, garbledSource, sameAsGarbled, repairPath };
