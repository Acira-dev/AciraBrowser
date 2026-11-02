'use strict';
// Bounce-tracking mitigation by debouncing (F16). Chromium's own Bounce Tracking Mitigations (BTM/DIPS) record bounces in
// this runtime but never delete state (verified in qa/privacy-plus/bounce-experiment.cjs), so we do what Brave does:
// when a navigation targets a known link-tracking redirector, go straight to the destination the redirector would send
// you to. Port of brave-core components/debounce/core/browser/debounce_rule.cc (MPL-2.0, brave-core master, 24 Oct 2026);
// rules from brave/adblock-lists brave-lists/debounce.json (MPL-2.0). The same failsafes apply: http(s) only, never
// the same site, destination host must parse identically in a naive reader, destination must have a registrable domain.
const fs = require('node:fs'), { getDomain, parse } = require('tldts');
const ACTIONS = new Set(['redirect', 'base64,redirect', 'regex-path', 'regex-path-template']), MAX_REGEX = 1000;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Chrome match pattern (`*://*.example.com/path*`) -> predicate on a parsed URL. Query counts as part of the path, as in Chromium. */
function matcher(pattern) {
  const m = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(pattern); if (!m) return null;
  const [, scheme, host, path] = m, hostRe = host === '*' ? null : host.startsWith('*.') ? new RegExp('^(?:.+\\.)?' + escape(host.slice(2)) + '$') : new RegExp('^' + escape(host) + '$'), pathRe = new RegExp('^' + path.split('*').map(escape).join('.*') + '$');
  const test = url => (scheme === '*' ? /^https?:$/.test(url.protocol) : url.protocol === scheme + ':') && (!hostRe || hostRe.test(url.hostname)) && pathRe.test(url.pathname + url.search);
  test.host = host === '*' ? '' : host.replace(/^\*\./, ''); return test;
}
const etld = host => getDomain(host, { allowPrivateDomains: true }) || '';
const naiveHost = spec => { const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]*)/i.exec(spec); return m ? m[1].toLowerCase() : ''; };
function decode(value) { try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch { return null; } }
function parseRules(text) {
  const raw = JSON.parse(text); if (!Array.isArray(raw)) throw new Error('Debounce rules must be a list.');
  const rules = [], hosts = new Set();
  for (const item of raw) {
    // Of Brave's pref-gated rules only de-AMP's are kept; they run while the de-AMP switch is on (navigation-clean.cjs).
    if (!item || !ACTIONS.has(item.action) || typeof item.param !== 'string' || !Array.isArray(item.include) || item.pref && item.pref !== 'brave.de_amp.enabled') continue;
    const include = item.include.map(matcher).filter(Boolean), exclude = (Array.isArray(item.exclude) ? item.exclude : []).map(matcher).filter(Boolean);
    if (!include.length) continue;
    const rule = { action: item.action, param: item.param, include, exclude, scheme: item.prepend_scheme === 'http' || item.prepend_scheme === 'https' ? item.prepend_scheme : '', template: typeof item.redirect_url_template === 'string' ? item.redirect_url_template : '', deAmp: item.pref === 'brave.de_amp.enabled' };
    if (rule.action.startsWith('regex-path')) { if (rule.param.length > MAX_REGEX) continue; try { const re = new RegExp(rule.param); rule.regex = re; } catch { continue; } }
    for (const test of include) if (test.host) { const domain = etld(test.host); if (domain) hosts.add(domain); }
    rules.push(rule);
  }
  return { rules, hosts };
}
function extract(rule, url) {
  if (rule.action === 'regex-path' || rule.action === 'regex-path-template') {
    const match = rule.regex.exec(url.pathname); if (!match || match.length < 2) return null;
    const groups = match.slice(1).map(g => g ?? '');
    let value;
    if (rule.action === 'regex-path-template') {
      if (groups.length > 9) return null;
      const used = new Set([...rule.template.matchAll(/\$([1-9])/g)].map(m => Number(m[1])));
      for (let i = 1; i <= groups.length; i++) if (!used.delete(i)) return null;
      if (used.size) return null;
      value = rule.template; groups.forEach((g, i) => { value = value.split('$' + (i + 1)).join(g); });
    } else value = groups.filter(Boolean).join('');
    return value ? decode(value) : '';
  }
  const value = url.searchParams.get(rule.param); if (value === null) return null;
  if (rule.action === 'base64,redirect') { try { return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return null; } }
  return value;
}
function apply(rule, original) {
  if (rule.exclude.some(test => test(original)) || !rule.include.some(test => test(original))) return null;
  const value = extract(rule, original); if (value === null || value === '') return null;
  let spec = value, target = parseUrl(spec);
  if (rule.scheme && target) return null; // a prepend_scheme rule that already got a full URL is an erroneous rule
  if (rule.scheme && !target) { spec = rule.scheme + '://' + value; target = parseUrl(spec); }
  if (!target || !/^https?:$/.test(target.protocol)) return null;
  if (etld(original.hostname) === etld(target.hostname)) return null; // never redirect to the same site
  if (naiveHost(spec) !== target.hostname) return null;
  if (!etld(target.hostname)) return null;
  return target.href;
}
const parseUrl = spec => { try { return new URL(spec); } catch { return null; } };
function createDebouncer({ rules: source, text, filePath, io = fs }) {
  const { rules, hosts } = parseRules(text ?? source ?? io.readFileSync(filePath, 'utf8')), stats = { debounced: 0 }, recent = new Map();
  return {
    rules: rules.length,
    /** Destination to use instead of `href`, or null. Several hops are followed so a chain of redirectors collapses to one navigation. */
    destination(href, { deAmp = false } = {}) {
      let current = parseUrl(href); if (!current || !/^https?:$/.test(current.protocol) || !hosts.has(etld(current.hostname))) return null;
      let result = null;
      for (let hop = 0; hop < 5 && current; hop++) {
        let next = null;
        if (hosts.has(etld(current.hostname))) for (const rule of rules) { if (rule.deAmp && !deAmp) continue; next = apply(rule, current); if (next) break; }
        if (!next) break; result = next; current = parseUrl(next);
      }
      if (result) { stats.debounced++; recent.set(Date.now(), parse(href).domain + ' -> ' + (parse(result).domain || '')); if (recent.size > 20) recent.delete(recent.keys().next().value); }
      return result;
    },
    stats: () => ({ ...stats, rules: rules.length, recent: [...recent.values()].slice(-5) })
  };
}
module.exports = { createDebouncer, parseRules, matcher };
