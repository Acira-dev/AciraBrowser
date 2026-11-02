'use strict';
// Clean navigations (parity audit #8). Two parts:
// 1. Tracking parameters are stripped from top-level navigations, not only from copied links. Port of brave-core
//    components/query_filter/browser/utils.cc (MPL-2.0, brave-core master 1e6f002, 24 Oct 2026); rules from brave/adblock-lists
//    brave-lists/query-filter.json (MPL-2.0, ff303c3) -> resources/filters/query-filter.json, plus the parameters the copy
//    cleaner already knows (clean-link.cjs). As in Brave: GET only, cross-site only (a site keeps its own parameters), query
//    tokens are removed without re-encoding the rest, a few parameters only outside unsubscribe/e-mail pages, and exempt
//    hosts. As in the copy cleaner: signed and authentication links are never touched.
// 2. De-AMP. AMP cache URLs are handled by the debounce rules (debounce.cjs, `deAmp`); AMP pages themselves are found the way
//    brave-core components/de_amp/browser/de_amp_util.cc does (<html amp|⚡> plus <link rel=canonical>), here by a frame
//    preload (de-amp-preload.cjs) that asks `deAmpTarget` whether to replace the page with its canonical URL. Brave reads the
//    response body before commit; a preload sees the same markup as soon as <head> is parsed, before the body paints.
// Both follow the anti-tracking switches and the per-site protection switch, and an allowlist for sites they would break.
const fs = require('node:fs'), { getDomain } = require('tldts'), { cleanLink, TRACKING } = require('./clean-link.cjs');

// brave-core utils.cc kConditionalQueryStringTrackers: stripped only when the URL does not match the pattern.
const CONDITIONAL = new Map([['ck_subscriber_id', /\/unsubscribe/], ['h_sid', /\/email\//], ['h_slt', /\/email\//], ['mkt_tok', /([uU]nsubscribe|emailWebview)/]]);
// brave-core kExemptedHostnames, plus sites known to need these parameters on arrival.
const EXEMPT_HOSTS = new Set(['urldefense.com']);
const MAX_RULES = 200, MAX_PARAMS = 500, MAX_URL = 16384;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const etld = host => getDomain(host, { allowPrivateDomains: true }) || host || '';
const parse = spec => { try { return new URL(spec); } catch { return null; } };

/** Chrome match pattern (`*://*.example.com/*`) -> predicate on a parsed URL, as url_pattern_index matches them. */
function matcher(pattern) {
  const m = typeof pattern === 'string' && /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(pattern.trim()); if (!m) return null;
  const [, scheme, host, path] = m, hostRe = host === '*' ? null : host.startsWith('*.') ? new RegExp('^(?:.+\\.)?' + escape(host.slice(2)) + '$') : new RegExp('^' + escape(host) + '$'), pathRe = new RegExp('^' + path.split('*').map(escape).join('.*') + '$');
  return url => (scheme === '*' ? /^https?:$/.test(url.protocol) : url.protocol === scheme + ':') && (!hostRe || hostRe.test(url.hostname)) && pathRe.test(url.pathname + url.search);
}

function parseRules(text) {
  const raw = JSON.parse(text); if (!Array.isArray(raw) || raw.length > MAX_RULES) throw new Error('Query-filter rules must be a short list.');
  const rules = [];
  for (const item of raw) {
    if (!item || !Array.isArray(item.include) || !Array.isArray(item.params) || item.params.length > MAX_PARAMS) continue;
    const include = item.include.map(matcher).filter(Boolean), exclude = (Array.isArray(item.exclude) ? item.exclude : []).map(matcher).filter(Boolean);
    const params = item.params.filter(p => typeof p === 'string' && p && p.length < 100);
    if (include.length && params.length) rules.push({ include, exclude, params });
  }
  if (!rules.length) throw new Error('No usable query-filter rules.');
  return rules;
}

/** The URL without its tracking parameters, or null when nothing would change (brave-core ApplyQueryFilter). */
function stripTracking(href, rules) {
  if (typeof href !== 'string' || href.length > MAX_URL) return null;
  const url = parse(href); if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password || !url.search || EXEMPT_HOSTS.has(url.hostname)) return null;
  // Signed and authentication links stay byte for byte, as the copy cleaner keeps them.
  if (cleanLink(href).reason === 'authentication-or-signed-link') return null;
  const blocked = new Set();
  for (const rule of rules) if (!rule.exclude.some(test => test(url)) && rule.include.some(test => test(url))) for (const p of rule.params) blocked.add(p);
  const query = url.search.slice(1), kept = [], removed = [];
  for (const token of query.split('&')) {
    const at = token.indexOf('='), param = at < 0 ? '' : token.slice(0, at), value = at < 0 ? '' : token.slice(at + 1);
    // Not param=value, or an empty name or value: kept as it is (brave-core does the same).
    if (!param || !value) { kept.push(token); continue; }
    const pattern = CONDITIONAL.get(param);
    // Brave's rules match exactly; the copy cleaner's list ignores case, as it does there.
    if (blocked.has(param) || TRACKING.has(param.toLowerCase()) || pattern && !pattern.test(href)) { removed.push(param); continue; }
    kept.push(token);
  }
  if (!removed.length) return null;
  const clean = kept.join('&');
  return { url: url.origin + url.pathname + (clean ? '?' + clean : '') + url.hash, removed: [...new Set(removed)] };
}

// brave-core de_amp_util.cc: the <html> tag carries amp/⚡, and the canonical link must be http(s) and a different URL.
function verifyCanonical(canonical, original) {
  const target = parse(canonical), from = parse(original);
  return !!target && !!from && /^https?:$/.test(target.protocol) && !target.username && !target.password && target.href !== from.href && target.href.length <= MAX_URL;
}

/**
 * @param {object} options
 * @param {string} [options.rulesPath] query-filter.json; or `text` for tests.
 * @param {() => {stripTrackingParams?: boolean, deAmp?: boolean}} options.settings the anti-tracking switches.
 * @param {(session: any, wc: any, url: string) => boolean} options.enabled the per-site protection switch.
 * @param {(details: any) => any} options.contents the webContents of a request.
 * @param {string[]} [options.allow] registrable domains where neither part runs (breakage allowlist).
 */
function createNavigationCleaner({ rulesPath, text, settings, enabled, contents, allow = [], io = fs, now = Date.now }) {
  const rules = parseRules(text ?? io.readFileSync(rulesPath, 'utf8')), allowed = new Set(allow), stats = { stripped: 0, deAmped: 0 }, recent = new Map();
  const permitted = (session, wc, href) => { const url = parse(href); return !!url && !allowed.has(etld(url.hostname)) && enabled(session, wc, href); };
  return {
    stripTracking: href => stripTracking(href, rules),
    /** Request-pipeline step for main-frame navigations: a redirect to the same URL without tracking parameters. */
    before(details) {
      if (details.resourceType !== 'mainFrame' || details.method !== 'GET' || !settings().stripTrackingParams) return {};
      const result = stripTracking(details.url, rules); if (!result) return {};
      const wc = contents(details), target = parse(details.url), previous = parse(wc?.getURL?.() || '');
      // Same-site navigations keep their parameters (a site may rely on its own); typed and new-tab loads are cleaned.
      if (!target || previous && /^https?:$/.test(previous.protocol) && etld(previous.hostname) === etld(target.hostname)) return {};
      if (!permitted(details.webContents?.session || wc?.session, wc, details.url)) return {};
      stats.stripped++;
      return { redirectURL: result.url };
    },
    /** Called by the de-AMP preload from a page's top frame: the canonical URL to load instead, or null. */
    deAmpTarget(wc, page, canonical) {
      if (!wc || typeof page !== 'string' || typeof canonical !== 'string' || !settings().deAmp) return null;
      let target; try { target = new URL(canonical, page).href; } catch { return null; }
      if (!verifyCanonical(target, page) || !permitted(wc.session, wc, page)) return null;
      // Loop guard (brave-core keeps the navigation chain): never de-AMP into a page this tab was just de-AMPed from or to.
      const time = now(), chain = recent.get(wc.id) || [];
      const fresh = chain.filter(entry => time - entry.time < 15000);
      if (fresh.some(entry => entry.from === target || entry.to === page)) return null;
      fresh.push({ from: page, to: target, time }); recent.set(wc.id, fresh.slice(-6)); if (recent.size > 200) recent.delete(recent.keys().next().value);
      stats.deAmped++;
      return stripTracking(target, rules)?.url || target;
    },
    release: wc => recent.delete(wc?.id),
    stats: () => ({ ...stats, rules: rules.length })
  };
}

module.exports = { createNavigationCleaner, stripTracking, parseRules, verifyCanonical, CONDITIONAL };
