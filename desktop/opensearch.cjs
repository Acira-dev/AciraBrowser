'use strict';
/**
 * Beta 14: pick up a site's own suggestion address (OpenSearch) when the person adds that site as a search engine.
 *
 * A site advertises its search with <link rel="search" type="application/opensearchdescription+xml" href="..."> on its pages; the description names the engine and its
 * addresses: <Url type="text/html" template="https://site/search?q={searchTerms}"/> and <Url type="application/x-suggestions+json" template="https://site/suggest?q={searchTerms}"/>.
 * This reads those two addresses (as ours: {searchTerms} becomes %s, https only, one %s) and nothing else. It is asked only when the person adds an engine with the suggestion
 * switch on, from an ordinary window; the request is the plain page visit of the transport in search-suggest.cjs (no cookies, no referrer, no identifiers).
 */
const { searchTemplate, suggestTemplate } = require('./browser-services/search-providers.cjs');

const MAX_PAGE_BYTES = 256 * 1024, MAX_XML_BYTES = 128 * 1024;
const decodeEntities = text => String(text).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const attr = (tag, name) => { const match = new RegExp('(?:^|[\\s"\'/])' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag); return match ? decodeEntities(match[1] ?? match[2]) : null; };

/** The first <link rel="search" type="application/opensearchdescription+xml"> of a page, as an absolute address, or null. */
function findDescriptionLink(html, base) {
  for (const tag of String(html).slice(0, MAX_PAGE_BYTES).match(/<link\b[^>]*>/gi) || []) {
    const rel = (attr(tag, 'rel') || '').toLowerCase().split(/\s+/), type = (attr(tag, 'type') || '').toLowerCase(), href = attr(tag, 'href');
    if (!rel.includes('search') || !type.startsWith('application/opensearchdescription+xml') || !href) continue;
    try { const url = new URL(href, base); if (url.protocol === 'https:') return url.href; } catch { /* a link that is not an address */ }
  }
  return null;
}

/** The engine a description names: { name, template, suggest? } with our %s in each address, or null when it has no usable search address. */
function parseDescription(xml) {
  const text = String(xml).slice(0, MAX_XML_BYTES);
  if (!/<OpenSearchDescription\b/i.test(text)) return null;
  const name = decodeEntities((/<ShortName>([\s\S]*?)<\/ShortName>/i.exec(text) || [])[1] || '').trim().slice(0, 80);
  const found = { html: null, suggest: null };
  for (const match of text.matchAll(/<Url\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Url>)/gi)) {
    const tag = match[1], type = (attr(tag, 'type') || '').toLowerCase(), method = (attr(tag, 'method') || 'get').toLowerCase();
    let template = attr(tag, 'template');
    if (!template || method !== 'get') continue;
    // <Param name="q" value="{searchTerms}"/> children join the address as its query
    const params = [...(match[2] || '').matchAll(/<Param\b([^>]*?)\/?>/gi)].map(param => [attr(param[1], 'name'), attr(param[1], 'value')]).filter(([key, value]) => key && value !== null);
    if (params.length) template += (template.includes('?') ? '&' : '?') + params.map(([key, value]) => `${encodeURIComponent(key)}=${value}`).join('&');
    template = template.replace(/\{searchTerms\??\}/g, '%s').replace(/\{[A-Za-z:]+\?\}/g, '').replace(/[?&](?=$|&)/g, '');
    const slot = type === 'application/x-suggestions+json' ? 'suggest' : type === 'text/html' || type === 'application/xhtml+xml' ? 'html' : null;
    if (slot && !found[slot]) found[slot] = template;
  }
  let search = null, suggest = null;
  try { search = found.html ? searchTemplate(found.html) : null; } catch { /* not usable as ours */ }
  try { suggest = found.suggest ? suggestTemplate(found.suggest) : null; } catch { /* not usable as ours */ }
  return search ? { name: name || new URL(search.replace('%s', 'x')).hostname, template: search, ...suggest ? { suggest } : {} } : null;
}

/**
 * Looks a site up: `address` is a site's page (its link names the description) or the description itself. `transport(url, { accept, maxBytes })` answers { status, text }.
 * Resolves { name, template, suggest? } or null; it never rejects (a site that does not answer has no engine to pick up).
 */
async function lookupEngine(address, { transport }) {
  try {
    const start = new URL(address);
    if (start.protocol !== 'https:' || start.username || start.password) return null;
    const first = await transport(start.href, { accept: 'text/html,application/opensearchdescription+xml,application/xml;q=0.9,*/*;q=0.1', maxBytes: MAX_PAGE_BYTES, timeoutMs: 5000 });
    const direct = parseDescription(first.text);
    if (direct) return direct;
    const link = findDescriptionLink(first.text, start.href);
    if (!link) return null;
    const second = await transport(link, { accept: 'application/opensearchdescription+xml,application/xml;q=0.9,*/*;q=0.1', maxBytes: MAX_XML_BYTES, timeoutMs: 5000 });
    return parseDescription(second.text);
  } catch { return null; }
}

module.exports = { findDescriptionLink, parseDescription, lookupEngine };
