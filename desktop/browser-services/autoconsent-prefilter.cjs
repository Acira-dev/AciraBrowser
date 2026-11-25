'use strict';
// Which cookie-banner site rules can apply to an address, found without running their address patterns (Beta 14.2 page-load pass).
//
// Why: DuckDuckGo's autoconsent library keeps about 860 site rules, each with an address pattern, and filterCompactRules runs every pattern against the
// page's address (`url.match(pattern)`: a new RegExp per call). Main does that inside the page's document-start question (frame-boot), the page waits for
// it, and the requests it sent at commit queue behind it. V8 throws away the compiled code of regular expressions that were not used for a couple of garbage
// collections, so after the first page every address pays the compile of all of them again: 0.2 ms hot, 5-9 ms after two full GCs in Node, 7.5-12 ms
// measured in main on every new address (traced loads of the packaged 14.1 build).
//
// What: for each rule, the text its address pattern requires (below). An address is looked at with `String.prototype.includes` against those texts (no
// regular expression runs), and only the rules whose text it contains, plus the rules whose pattern gives no provable text, are handed to the library's own
// filterCompactRules, which makes the real decision. So the answer is the library's, byte for byte, as long as the prefilter never drops a rule the library
// would have kept (conservative). The library is also used unchanged when its rule format is not the one read here.
//
// How the required text is derived (a pattern is the library's `new RegExp(pattern)`: no flags, so case-sensitive, code unit by code unit, as `includes` is):
//   - the pattern is split at its top-level `|` (outside groups, classes and escapes). An address matches the pattern only if it matches ONE alternative, so
//     the rule's texts are one per alternative and an address must contain AT LEAST ONE of them. An alternative with no usable text puts the whole rule on the
//     "always test" list;
//   - inside an alternative only these atoms are read, in order: a plain character, or an escaped punctuation mark (`\.`, `\/`, `\-`), is a literal;
//     a literal that is not followed by `?`, `*` or `{0...}` is required and joins the run it follows; `+` and `{n,..}` with n >= 1 require it once and end the run
//     (what comes after a repeated atom is not next to it); a literal made optional leaves the run and ends it; `.`, a class `[...]`, a group `(...)` (also with
//     alternatives, look-aheads, back-references inside) are skipped whole and END the run, never read; `^` and `$` end the run;
//   - anything else (an escaped letter or digit: `\w`, `\d`, `\b`, `\1`..., a stray `]` `}` `)`, a malformed `{`) makes the alternative give up;
//   - the text of an alternative is its longest run, with a leading `http://` or `https://` cut off it (a part of a required text is required too; the bare
//     scheme would pick 25 rules for every address). Every string the alternative matches contains every such run, because the run is made of required atoms
//     that stand next to each other in the pattern, so it stands next to each other in the match. A text shorter than MIN_KEY would pick too many rules, so
//     that rule goes to the "always test" list as well.
// The library's own test then runs on the few candidates, and it is the only judge of a rule. tests/autoconsent-prefilter.test.cjs proves the derivation
// on generated patterns and strings, and the whole filter against the library on a large corpus of addresses (every rule's hosts in upper and mixed case,
// punycode, ports, user information, trailing dot, query and fragment only, very long, non-web frames, both frame kinds), and fails with a wrong table.
const MIN_KEY = 6;

/** The end of a character class that starts at `at` (`[`), or -1. The first `]` not escaped closes it (an empty `[]` and `[^]` included, as in JavaScript). */
function classEnd(src, at) {
  let k = at + 1;
  if (src[k] === '^') k++;
  for (; k < src.length; k++) {
    if (src[k] === '\\') { k++; continue; }
    if (src[k] === ']') return k;
  }
  return -1;
}

/** The end of the group that starts at `at` (`(`), or -1. */
function groupEnd(src, at) {
  let depth = 0;
  for (let k = at; k < src.length; k++) {
    const c = src[k];
    if (c === '\\') { k++; continue; }
    if (c === '[') { const end = classEnd(src, k); if (end < 0) return -1; k = end; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return k; }
  }
  return -1;
}

/** The pattern's top-level alternatives, or null when it is not well formed. */
function topLevelAlternatives(src) {
  const out = []; let depth = 0, current = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { if (i + 1 >= src.length) return null; current += src.slice(i, i + 2); i += 2; continue; }
    if (c === '[') { const end = classEnd(src, i); if (end < 0) return null; current += src.slice(i, end + 1); i = end + 1; continue; }
    if (c === '(') depth++;
    else if (c === ')') { if (--depth < 0) return null; }
    else if (c === '|' && depth === 0) { out.push(current); current = ''; i++; continue; }
    current += c; i++;
  }
  if (depth !== 0) return null;
  out.push(current);
  return out;
}

/** The quantifier at `at`: {min, next, none} (`none` when there is no quantifier), or null when it is not one this reader knows. */
function quantifierAt(alt, at) {
  const c = alt[at];
  let min, next;
  if (c === '?' || c === '*') { min = 0; next = at + 1; }
  else if (c === '+') { min = 1; next = at + 1; }
  else if (c === '{') {
    const m = /^\{(\d+)(?:,(\d*))?\}/.exec(alt.slice(at, at + 24));
    if (!m) return null;
    min = Number(m[1]); next = at + m[0].length;
  } else return {min: 1, next: at, none: true};
  if (alt[next] === '?') next++;
  return {min, next, none: false};
}

/** The longest text that every match of one alternative must contain, or null (see the header). */
function requiredText(alt) {
  let run = '', best = '', i = 0;
  // A run that starts with the scheme is cut to what follows it (a part of a required text is required too): "https://" alone would pick 25 rules for every address.
  const endRun = () => { const text = run.replace(/^https?:\/\//, ''); if (text.length > best.length) best = text; run = ''; };
  while (i < alt.length) {
    const c = alt[i];
    let literal = null, next;
    if (c === '\\') {
      const e = alt[i + 1];
      if (e === undefined || /[A-Za-z0-9]/.test(e)) return null;
      literal = e; next = i + 2;
    } else if (c === '[') { const end = classEnd(alt, i); if (end < 0) return null; next = end + 1; }
    else if (c === '(') { const end = groupEnd(alt, i); if (end < 0) return null; next = end + 1; }
    else if (c === '.') next = i + 1;
    else if (c === '^' || c === '$') { endRun(); i++; continue; }
    else if ('*+?{}])|'.includes(c)) return null;
    else { literal = c; next = i + 1; }
    const q = quantifierAt(alt, next);
    if (!q) return null;
    if (literal !== null && q.min >= 1) { run += literal; if (!q.none) endRun(); }
    else endRun();
    i = q.next;
  }
  endRun();
  return best || null;
}

/** The texts of one address pattern (one per top-level alternative, each at least `minKey` long), or null when the rule must always be tested by the library. */
function patternKeys(pattern, minKey = MIN_KEY) {
  if (typeof pattern !== 'string' || !pattern) return null;
  const alternatives = topLevelAlternatives(pattern);
  if (!alternatives) return null;
  const keys = [];
  for (const alt of alternatives) {
    const key = requiredText(alt);
    if (key === null || key.length < minKey) return null;
    keys.push(key);
  }
  return keys;
}

/** The table for a list of compact rules (rule[3] is the address pattern): text -> indexes of the rules it can belong to, and the rules always tested. */
function buildTable(rules, minKey = MIN_KEY) {
  const keys = new Map(), always = [];
  rules.forEach((rule, at) => {
    const found = Array.isArray(rule) ? patternKeys(rule[3], minKey) : null;
    if (!found) { always.push(at); return; }
    for (const key of found) {
      let list = keys.get(key);
      if (!list) keys.set(key, list = []);
      if (list[list.length - 1] !== at) list.push(at);
    }
  });
  return {keys, keyList: [...keys.keys()], always, rules: rules.length, keyed: rules.length - always.length};
}

/** The indexes (ascending, each once) of the rules whose pattern could match `url`: those whose text it contains, and the always-tested ones. */
function candidates(table, url) {
  const hit = new Set(table.always);
  for (const key of table.keyList) if (url.includes(key)) for (const at of table.keys.get(key)) hit.add(at);
  return [...hit].sort((a, b) => a - b);
}

/**
 * The library's filterCompactRules for one address, with the pattern runs spared. `tables` ({specific, frame}) is for tests (a wrong table must be caught);
 * null when the compact rules are not in the format read here, then the caller uses the library's function as it is.
 */
function createPrefilter(compact, library, tables = null) {
  const index = compact?.index;
  if (!index || !Array.isArray(compact.r) || typeof library?.filterCompactRules !== 'function') return null;
  const ranges = ['genericRuleRange', 'specificRuleRange', 'frameRuleRange'];
  if (!ranges.every(name => Array.isArray(index[name]) && index[name].length === 2)) return null;
  const {v, s, r} = compact;
  const generic = r.slice(...index.genericRuleRange), specific = r.slice(...index.specificRuleRange), framed = r.slice(...index.frameRuleRange);
  const specificTable = tables?.specific || buildTable(specific), frameTable = tables?.frame || buildTable(framed);
  // A new library whose patterns this reader cannot use would make the prefilter a cost, not a saving: then the library's own function is used.
  if (!tables && (specificTable.keyed < 0.95 * specificTable.rules || (frameTable.rules && frameTable.keyed < 0.5 * frameTable.rules))) return null;
  const mainOf = list => ({v, s, r: [...generic, ...list], index: {...index, genericRuleRange: [0, generic.length], specificRuleRange: [generic.length, generic.length + list.length]}});
  const frameOf = list => ({v, s, r: list, index: {...index, frameRuleRange: [0, list.length]}});
  const none = mainOf([]);
  return {
    specificTable, frameTable,
    filter(url, mainFrame) {
      if (typeof url !== 'string') return library.filterCompactRules(compact, {url, mainFrame});
      if (mainFrame) {
        const picked = candidates(specificTable, url);
        return library.filterCompactRules(picked.length ? mainOf(picked.map(at => specific[at])) : none, {url, mainFrame: true});
      }
      return library.filterCompactRules(frameOf(candidates(frameTable, url).map(at => framed[at])), {url, mainFrame: false});
    }
  };
}

module.exports = {createPrefilter, buildTable, candidates, patternKeys, requiredText, topLevelAlternatives, MIN_KEY};
