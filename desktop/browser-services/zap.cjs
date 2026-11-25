'use strict';
// Beta 14, Zap: the person points at a part of a page, clicks, and it is gone for good on that site. This is the main-process side: the rules (what is removed, where), the
// style sheet a page starts with, and the requests the site controls and Settings use. The page side (picking, the leave animation, the watch for parts that come back) is
// zap-preload.cjs; the picker's layer above the page is desktop/zap-layer.cjs.
//
// How it hides: exactly as the ad-block engine's cosmetic filters do, with a user-origin style sheet of `selector { display: none !important }` that the page cannot see, restyle,
// remove or block with a content security policy, put in by the preload before the page lays anything out (so nothing flashes). The part stays in the page (a script that
// looks for it still finds it: nothing is deleted, nothing breaks). One rule per selector, never one comma list: a comma list with one selector the browser does not understand is
// dropped whole, and with the engine's own cosmetic output (probed in 13 Nov, @ghostery/adblocker 2.20.1: it joins every selector of a host into one list and does not check
// them) that would have switched off every zap on a site over one bad entry. Rules are written `host##selector` in the page-facing notation (uBlock syntax), kept in the profile's
// policy table under `zap:<host>` (so they go wherever the profile's other per-site settings go) and in memory only in private and Tor windows.
//
// Privacy: nothing is sent anywhere. The site is not told. Private and Tor windows keep their own list in memory, never read the profile's, and forget it with the window.

const {parse} = require('tldts');

const PREFIX = 'zap:', KINDS = Object.freeze(['frame', 'video', 'image', 'bar', 'popup', 'widget', 'block']);
const LIMITS = Object.freeze({rulesPerHost: 80, hosts: 2000, selectors: 3, deep: 2, steps: 6, selectorLength: 700, labelLength: 90, textLength: 60});

/** The site key of a web address: the host, lower case, without a trailing dot and a leading "www." ('' for anything that is not an http(s) page). */
function hostKey(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return ''; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '').replace(/^www\./, '');
  return host && host.length <= 253 ? host : '';
}

/** The keys whose rules apply on a host: the host itself and every parent host down to its registrable domain (a rule made on example.com also applies on shop.example.com; never one made on a public suffix such as co.uk or github.io). */
function applicableKeys(host) {
  host = String(host || '');
  if (!host) return [];
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(':') || !host.includes('.')) return [host];
  const parsed = parse(host, {allowPrivateDomains: true}), floor = (parsed.domain || host.split('.').slice(-2).join('.')).split('.').length, labels = host.split('.'), keys = [];
  for (let start = 0; labels.length - start >= floor; start += 1) keys.push(labels.slice(start).join('.'));
  return keys.length ? keys : [host];
}

// A selector goes into a style sheet, so it must be exactly one selector and nothing else: no declaration block, no at-rule, no comment, no list, strings and brackets closed.
const FORBIDDEN = /[{};<\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** Throws a plain message unless `text` is one safe selector; returns it trimmed. */
function checkSelector(text) {
  if (typeof text !== 'string') throw new Error('A selector is text.');
  const selector = text.trim();
  if (!selector || selector.length > LIMITS.selectorLength) throw new Error('That selector is empty or too long.');
  if (FORBIDDEN.test(selector)) throw new Error('That selector has characters a selector cannot have.');
  let quote = null, square = 0, round = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if (c === '\\') { i += 1; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[') square += 1;
    else if (c === ']') { square -= 1; if (square < 0) throw new Error('That selector closes a bracket it did not open.'); }
    else if (c === '(') round += 1;
    else if (c === ')') { round -= 1; if (round < 0) throw new Error('That selector closes a bracket it did not open.'); }
    else if (c === ',' && !square && !round) throw new Error('One selector at a time.');
    else if (c === '/' && selector[i + 1] === '*') throw new Error('A selector has no comments.');
    else if (c === '@') throw new Error('A selector has no at-rules.');
  }
  if (quote || square || round) throw new Error('That selector is not closed.');
  if (WHOLE_PAGE.test(selector)) throw new Error('That would remove the whole page.');
  if (/^(?:html|:root)(?![\w-])/i.test(selector)) throw new Error('A selector starts below the root of the page.');   // the page-wide gate (compile) sits on the root, so a selector cannot start at it
  return selector;
}
// Selectors that name the page itself or everything: never stored (the page side refuses them too).
const WHOLE_PAGE = /^(?:\*|:root|html|body|head|html\s*>\s*body|html\s+body|:root\s*>\s*body|body\s*>\s*\*|body\s+\*|html\s+\*|:not\([^)]*\))$/i;

const text = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const slug = () => 'z' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 8);

/** What a page gave us as a rule, checked and cut to size. Throws a plain message when nothing usable is left. */
function cleanRule(input, {now = Date.now(), id} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A removal is an object.');
  const sels = [];
  for (const item of Array.isArray(input.sels) ? input.sels.slice(0, 8) : []) { try { const one = checkSelector(item); if (!sels.includes(one)) sels.push(one); } catch { /* an unusable one is simply not kept */ } }
  const deep = [];
  for (const path of Array.isArray(input.deep) ? input.deep.slice(0, 4) : []) {
    if (!Array.isArray(path) || path.length < 2 || path.length > LIMITS.steps) continue;
    try { deep.push(path.map(checkSelector)); } catch { /* not kept */ }
  }
  if (!sels.length && !deep.length) throw new Error('Nothing in that removal can be found again.');
  const fp = input.fp && typeof input.fp === 'object' ? input.fp : {};
  const rule = {
    id: id || slug(),
    at: Number.isFinite(now) ? Math.floor(now) : Date.now(),
    label: text(input.label, LIMITS.labelLength),
    // What it is, so Settings can say "Chat window" in the person's language when the part has no words of its own: frame, video, image, bar, popup, widget, block.
    kind: KINDS.includes(input.kind) ? input.kind : 'block',
    sels: sels.slice(0, LIMITS.selectors),
    deep: deep.slice(0, LIMITS.deep),
    // How sure the rule is to find the part again: 'firm' (an id, a stable attribute or class), 'loose' (its place in the page, or its text), 'frame' (hidden whole: it lives in a frame or a closed shadow tree).
    hold: ['firm', 'loose', 'frame'].includes(input.hold) ? input.hold : 'loose',
    unlock: input.unlock === true,
    fp: {tag: text(fp.tag, 24).toLowerCase(), role: text(fp.role, 24), text: text(fp.text, LIMITS.textLength), place: ['fixed', 'sticky', 'absolute', 'flow'].includes(fp.place) ? fp.place : 'flow', src: text(fp.src, 120)},
  };
  return rule;
}

/** What a page starts with and is told when rules change: the style sheet and, for each rule, only what the page side needs to look for it again. */
const forPage = rules => rules.map(rule => ({id: rule.id, sels: rule.sels, deep: rule.deep, fp: rule.fp, unlock: rule.unlock}));

/** One style rule per selector (see the top of this file for why not a list), each switched on by the absence of its own id in the page's restore list (`data-zr` on the root).
 *  Electron cannot take a user-origin style sheet out of a page again (webFrame.removeInsertedCSS only knows author sheets: found in the real app, 14 Nov 2026), and the user origin is
 *  what makes the hiding unbeatable by the page, so the sheet only ever grows and restoring a removal is the page side writing that id into the list: the part is back at once. */
const gateLine = (id, selector) => ':root:not([data-zr~="' + id + '"]) ' + selector + '{display:none!important}';
const SAFE_ID = /^[a-z0-9]{6,24}$/;
function compile(rules) {
  const lines = [], seen = new Set();
  for (const rule of rules || []) for (const selector of rule.sels || []) { if (!SAFE_ID.test(String(rule.id))) continue; const line = gateLine(rule.id, selector); if (seen.has(line)) continue; seen.add(line); lines.push(line); }
  return lines.join('\n');
}
/** The same rules in the notation a list uses, for the person who wants to see or carry them ("example.com##.cookie-bar"). */
const notation = (host, rule) => (rule.sels || []).map(selector => host + '##' + selector);

/** The rules as the site controls and Settings show them: plain data, no selectors in the common view. */
const summary = (host, rule) => ({host, id: rule.id, label: rule.label, kind: rule.kind, at: rule.at, hold: rule.hold});

function createZap({database, now = () => Date.now()}) {
  const cache = new Map();   // profile id -> Map(host key -> rule[]), read once; kept in step by every change
  const memory = new Map();  // private profile id -> Map(host key -> rule[]): never written anywhere
  const isPrivate = profileId => String(profileId || '').startsWith('private-');

  function load(profileId) {
    if (isPrivate(profileId)) { if (!memory.has(profileId)) memory.set(profileId, new Map()); return memory.get(profileId); }
    if (!cache.has(profileId)) {
      const map = new Map();
      try { for (const row of database.policies(profileId)) if (row.site.startsWith(PREFIX) && Array.isArray(row.rules) && row.rules.length) map.set(row.site.slice(PREFIX.length), row.rules); } catch { /* a table that cannot be read gives no rules: pages load as before */ }
      cache.set(profileId, map);
    }
    return cache.get(profileId);
  }
  function save(profileId, host, rules) {
    const map = load(profileId);
    if (rules.length) map.set(host, rules); else map.delete(host);
    if (isPrivate(profileId)) return;
    if (rules.length) database.setPolicy(profileId, PREFIX + host, {rules}); else database.deletePolicy(profileId, PREFIX + host);
  }

  /** The rules that apply on a host (its own and its parents'), in the order they were made. */
  function rulesFor(profileId, host) {
    const map = load(profileId), found = [];
    for (const key of applicableKeys(host)) for (const rule of map.get(key) || []) found.push({...rule, host: key});
    return found.sort((a, b) => a.at - b.at);
  }
  /** What a page starts with: its style sheet and what the page side needs to watch for. null when the site has no rules (the common case). */
  function earlyFor(profileId, host) {
    const rules = rulesFor(profileId, host);
    if (!rules.length) return null;
    return {css: compile(rules), rules: forPage(rules)};
  }

  function add(profileId, host, input) {
    if (!host) throw new Error('Open a website first.');
    const map = load(profileId), mine = map.get(host) || [];
    if (mine.length >= LIMITS.rulesPerHost) throw new Error('This site has too many removed parts. Restore some first.');
    if (!map.has(host) && map.size >= LIMITS.hosts) throw new Error('Too many sites have removed parts. Clear some first.');
    const rule = cleanRule(input, {now: now()});
    // The same part removed twice is one removal.
    const twin = mine.find(other => other.sels.some(selector => rule.sels.includes(selector)));
    if (twin) return {rule: twin, again: true};
    save(profileId, host, [...mine, rule]);
    return {rule, again: false};
  }
  /** Updates a rule in place (the page side found the part again under a new name, or learned one more way to find it). */
  function amend(profileId, host, id, patch) {
    const mine = load(profileId).get(host) || [], at = mine.findIndex(rule => rule.id === id);
    if (at < 0) return null;
    const next = cleanRule({...mine[at], ...patch, sels: [...(patch.sels || []), ...mine[at].sels].slice(0, LIMITS.selectors), deep: patch.deep || mine[at].deep, fp: {...mine[at].fp, ...(patch.fp || {})}}, {now: mine[at].at, id});
    next.label = mine[at].label;
    const list = mine.slice(); list[at] = next; save(profileId, host, list);
    return next;
  }
  function remove(profileId, host, id) {
    const mine = load(profileId).get(host) || [], rule = mine.find(item => item.id === id);
    if (!rule) return null;
    save(profileId, host, mine.filter(item => item.id !== id));
    return rule;
  }
  /** Brings a removed rule back exactly as it was (the Undo after a removal). */
  function putBack(profileId, host, rule) {
    const mine = load(profileId).get(host) || [];
    if (mine.some(item => item.id === rule.id)) return rule;
    const next = [...mine, rule].sort((a, b) => a.at - b.at);
    save(profileId, host, next);
    return rule;
  }
  function removeHost(profileId, host) {
    const mine = load(profileId).get(host) || [];
    if (mine.length) save(profileId, host, []);
    return mine;
  }
  function clearAll(profileId) {
    const map = load(profileId), hosts = [...map.keys()];
    for (const host of hosts) save(profileId, host, []);
    return hosts;
  }
  /** Every removal of a profile for Settings: [{host, rules: [{id, label, at, hold}]}], sites in alphabetical order. */
  function listAll(profileId) {
    const map = load(profileId);
    return [...map.keys()].sort().map(host => ({host, rules: map.get(host).map(rule => summary(host, rule))}));
  }
  /** What the site controls show for a page: the removals that apply on this host, each under the site it was made on. */
  function listFor(profileId, host) { return rulesFor(profileId, host).map(rule => summary(rule.host, rule)); }
  const countFor = (profileId, host) => rulesFor(profileId, host).length;
  /** A private window is gone: its list goes with it. */
  function forgetPrivate(profileId) { memory.delete(profileId); }
  const reload = profileId => { cache.delete(profileId); };

  return {add, amend, remove, putBack, removeHost, clearAll, listAll, listFor, countFor, rulesFor, earlyFor, forgetPrivate, reload, isPrivate, load};
}

const stores = new WeakMap();
/** One store for a profile database, whatever the number of windows: a removal made in one window is at once what every other window reads. */
function sharedZap(database, options) { if (!stores.has(database)) stores.set(database, createZap({database, ...options})); return stores.get(database); }

module.exports = {createZap, sharedZap, forPage, hostKey, applicableKeys, checkSelector, cleanRule, compile, gateLine, notation, summary, PREFIX, LIMITS};
