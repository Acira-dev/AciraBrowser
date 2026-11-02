'use strict';
// uBlock/ABP syntax coverage matrix: one tiny list per case, judged through each engine's real API.  node qa/adblock-bench/syntax.cjs
const fs = require('node:fs'), path = require('node:path');
const { Request, FiltersEngine } = require('@ghostery/adblocker');
const { FilterSet, Engine, RuleTypes, FilterFormat } = require(process.env.ADBLOCK_RS_PATH);
const resources = JSON.parse(fs.readFileSync(path.join(process.env.ADBLOCK_BENCH_LISTS, 'brave-resources.json'), 'utf8'));
const ghosteryResources = fs.readFileSync(path.join(__dirname, '..', '..', 'resources', 'filters', 'resources.json'), 'utf8');
const g = (text) => { const e = FiltersEngine.parse(text, { loadNetworkFilters: true, loadCosmeticFilters: true, loadExtendedSelectors: true, enableMutationObserver: true }); try { e.updateResources(ghosteryResources, 'b'); } catch { } return e; };
const b = (text) => { const set = new FilterSet(true); set.addFilters(text, { format: FilterFormat.STANDARD, rule_types: RuleTypes.ALL }); const e = new Engine(set); e.useResources(resources); return e; };
const net = (text, url, source, type = 'script', method = 'GET') => ({
  ghostery: (() => { const r = g(text).match(Request.fromRawDetails({ url, sourceUrl: source, type, method })); return r.redirect ? 'redirect' : r.match ? 'block' : 'allow'; })(),
  brave: (() => { const r = b(text).check(url, source, type, method, true); return r.redirect ? 'redirect' : r.rewritten_url ? 'rewrite' : r.should_block ? 'block' : 'allow'; })()
});
const cos = (text, url) => {
  const p = new URL(url), ge = g(text), be = b(text);
  const gc = ge.getCosmeticsFilters({ url, hostname: p.hostname, domain: p.hostname.split('.').slice(-2).join('.'), classes: ['ad', 'banner'], ids: ['ad'], hrefs: [], getBaseRules: true, getInjectionRules: true, getExtendedRules: true, getRulesFromHostname: true, getRulesFromDOM: true });
  const bc = be.urlCosmeticResources(url), bh = be.hiddenClassIdSelectors(['ad', 'banner'], ['ad'], []);
  return { ghostery: { styles: gc.styles || '', scripts: gc.scripts || [], extended: (gc.extended || []).length }, brave: { hide: bc.hide_selectors || [], proc: bc.procedural_actions || [], script: bc.injected_script || '', generic: bh } };
};
const rows = [];
const add = (name, ghostery, brave, note = '') => rows.push({ name, ghostery, brave, note });
const expect = (name, text, url, source, want, type, method) => { const r = net(text, url, source, type, method); add(name, r.ghostery === want ? 'yes' : 'NO (' + r.ghostery + ')', r.brave === want ? 'yes' : 'NO (' + r.brave + ')'); };
const U = 'https://ads.example.com/x.js', S = 'https://news.test/';
expect('network: ||host^', '||ads.example.com^', U, S, 'block');
expect('network: @@ exception', '||ads.example.com^\n@@||ads.example.com/x.js', U, S, 'allow');
expect('network: $important beats @@', '||ads.example.com^$important\n@@||ads.example.com/x.js', U, S, 'block');
expect('network: $third-party / $3p', '||ads.example.com^$3p', U, S, 'block');
expect('network: $first-party / $1p', '||ads.example.com^$1p', U, 'https://ads.example.com/', 'block');
expect('network: $domain=a|~b', '||ads.example.com^$domain=news.test|~sub.news.test', U, S, 'block');
expect('network: $denyallow', '*$script,denyallow=ads.example.com,domain=news.test', U, S, 'allow');
expect('network: $badfilter', '||ads.example.com^\n||ads.example.com^$badfilter', U, S, 'allow');
expect('network: $redirect=noopjs', '||ads.example.com^$script,redirect=noopjs', U, S, 'redirect');
expect('network: $redirect-rule', '||ads.example.com^$redirect-rule=noopjs\n||ads.example.com^$script', U, S, 'redirect');
expect('network: $method=post', '||ads.example.com^$method=post', 'https://ads.example.com/p', S, 'block', 'xhr', 'POST');
expect('network: $to=', '*$script,to=example.com,domain=news.test', U, S, 'block');
expect('network: $from=', '||ads.example.com^$script,from=news.test', U, S, 'block');
expect('network: $all', '||ads.example.com^$all', 'https://ads.example.com/', S, 'block', 'sub_frame');
expect('network: $ctype/type list', '||ads.example.com^$script,image', U, S, 'block');
expect('network: regex /ads\\d+/', '/ads\\.example\\.com\\/[a-z]+\\.js/', U, S, 'block');
{ const r = net('||ads.example.com^$removeparam=utm', 'https://ads.example.com/a?utm=1&b=2', S, 'xhr'); const gb = g('||ads.example.com^$removeparam=utm').match(Request.fromRawDetails({ url: 'https://ads.example.com/a?utm=1&b=2', sourceUrl: S, type: 'xhr' })); const bb = b('||ads.example.com^$removeparam=utm').check('https://ads.example.com/a?utm=1&b=2', S, 'xhr', 'GET', true); add('network: $removeparam', gb.redirect || g('||ads.example.com^$removeparam=utm').getRemoveParam ? 'yes (engine API)' : 'no', bb.rewritten_url ? 'yes (rewritten_url)' : 'NO'); }
{ const gcsp = g("||ads.example.com^$csp=script-src 'none'").getCSPDirectives(Request.fromRawDetails({ url: 'https://ads.example.com/', sourceUrl: S, type: 'main_frame' })); add('network: $csp', gcsp ? 'yes' : 'NO', 'not in the Node binding', 'adblock-rust computes CSP directives in Rust, the JS binding does not expose them'); }
add('network: $header=', (() => { try { const e = g('||ads.example.com^$header=via:1.1'); return e ? 'parses' : 'NO'; } catch { return 'NO'; } })(), 'ignored by design', 'both need response headers; Ghostery evaluates them in onHeadersReceived');
// cosmetic
{ const c = cos('##.ad\nnews.test##.banner', 'https://news.test/'); add('cosmetic: generic ##.ad', /\.ad\b/.test(c.ghostery.styles) ? 'yes' : 'via DOM query', c.brave.generic.some(s => /\.ad\b/.test(s)) ? 'yes (class/id query)' : 'NO'); add('cosmetic: domain ##.banner', /\.banner/.test(c.ghostery.styles) ? 'yes' : 'NO', c.brave.hide.some(s => /banner/.test(s)) ? 'yes' : 'NO'); }
{ const c = cos('news.test##.banner\nnews.test#@#.banner', 'https://news.test/'); add('cosmetic: #@# exception', !/\.banner/.test(c.ghostery.styles) ? 'yes' : 'NO', !c.brave.hide.some(s => /banner/.test(s)) ? 'yes' : 'NO'); }
{ const c = cos('news.test##+js(set-constant, adblock, false)', 'https://news.test/'); add('scriptlet: ##+js(set-constant)', c.ghostery.scripts.length ? 'yes' : 'NO', c.brave.script ? 'yes' : 'NO'); }
{ const c = cos('news.test##+js(abort-on-property-read, Object.foo)', 'https://news.test/'); add('scriptlet: abort-on-property-read', c.ghostery.scripts.length ? 'yes' : 'NO', c.brave.script ? 'yes' : 'NO'); }
{ const c = cos('news.test##+js(json-prune, a.b)', 'https://news.test/'); add('scriptlet: json-prune', c.ghostery.scripts.length ? 'yes' : 'NO', c.brave.script ? 'yes' : 'NO'); }
{ const c = cos('news.test##div:has-text(Sponsored)', 'https://news.test/'); add('cosmetic: :has-text (procedural)', c.ghostery.extended ? 'yes (parsed; needs our content script)' : 'NO', c.brave.proc.length ? 'data only (browser must evaluate)' : 'NO', 'Acira currently passes getExtendedRules:false, so procedural rules are not applied by the shipped app either'); }
{ const c = cos('news.test##div:has(> .ad)', 'https://news.test/'); add('cosmetic: :has()', /has\(/.test(c.ghostery.styles) || c.ghostery.extended ? 'yes' : 'NO', c.brave.hide.some(s => /:has\(/.test(s)) || c.brave.proc.length ? 'yes' : 'NO'); }
{ const c = cos('news.test##.ad:style(opacity: 0 !important)', 'https://news.test/'); add('cosmetic: :style()', /opacity/.test(c.ghostery.styles) ? 'yes' : 'NO', c.brave.hide.length || c.brave.proc.length ? 'yes' : 'NO'); }
{ const c = cos('news.test##:xpath(//div[@class="ad"])', 'https://news.test/'); add('cosmetic: :xpath()', c.ghostery.extended ? 'yes (parsed)' : 'NO', c.brave.proc.length ? 'data only' : 'NO'); }
{ let ok = 'NO'; try { ok = g('news.test##^script:has-text(adblock)').getFilters().htmlFilters?.length ? 'yes (parsed)' : 'NO'; } catch { } add('HTML filtering ##^script:has-text', ok, 'not supported', 'needs response body rewriting in both'); }
{ const c = cos('news.test##.ad\n@@||news.test^$generichide', 'https://news.test/'); add('network: $generichide', 'see note', c.brave.generichide === undefined ? 'see note' : 'yes'); }
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('case', 38) + pad('Ghostery', 34) + 'adblock-rust (Node binding)');
for (const r of rows) console.log(pad(r.name, 38) + pad(r.ghostery, 34) + r.brave + (r.note ? '   // ' + r.note : ''));
fs.writeFileSync(path.join(__dirname, '..', '..', '.scratch-src', 'out', 'syntax.json'), JSON.stringify(rows, null, 1));
