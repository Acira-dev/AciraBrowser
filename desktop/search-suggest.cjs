'use strict';
/**
 * Beta 14: search suggestions from the search engine, opt-in (Settings, Search, "Show search suggestions as I type").
 *
 * Off by default, and nothing in this file runs until the person turned it on. When on, the text typed in the address bar goes to ONE service, chosen in
 * Settings, and nothing else does. The rules (the plan, all required) live here, in main, so they hold whatever the interface asks:
 *   - only the typed text, over HTTPS, from a clean network context that shares nothing with a person's tabs: an in-memory session of its own, no cookies sent or
 *     kept (`credentials: 'omit'`), no referrer, no authorization, a user agent with no Acira or Electron token, no install or client identifier;
 *   - never from a Private window or tab, never from a Tor one (nor a secured workspace), whatever the setting says;
 *   - nothing for text that looks like a web address (a scheme, a dot-and-domain shape, localhost, an IP address, a path), like a file path, like an acira:// address,
 *     nothing for text being pasted, nothing before 2 characters;
 *   - one request in flight at a time (a new one cancels the old; nothing is queued), given up after 1 second; a reply is read as at most 64 KB of plain text;
 *   - the replies are returned to the interface and kept nowhere: not in a file, not in history.
 * The interface twin of the address and source rules is src/runtime/searchSuggest.ts (tests/search-suggest.test.ts checks the two agree on a table).
 */
const SERVICES = require('./suggest-services.json').services;
const { suggestTemplate } = require('./browser-services/search-providers.cjs');

const MIN_CHARS = 2, MAX_CHARS = 100, MAX_ROWS = 5, MAX_CANDIDATES = 10, TIMEOUT_MS = 1000, MAX_BYTES = 64 * 1024, MAX_REDIRECTS = 2, MAX_ITEM_CHARS = 120;

const ADDRESS_WORD = /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+(?::\d+)?(?:[/?#].*)?$/u;
const IPV6_WORD = /^\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?(?::\d+)?$/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** Does the text look like something other than a search: a web address, a file path, an acira:// page, an IP address, localhost? */
function looksLikeAddress(text) {
  const value = String(text).trim();
  if (/^[a-z][a-z0-9+.-]*:\S/i.test(value)) return true;            // https://, acira://, file:, mailto:, javascript:, about:, localhost:3000
  if (/[\\/]/.test(value)) return true;                              // a path, a file path, a UNC path
  if (/@[^\s@]+\.[^\s@]+/.test(value)) return true;                    // an email address
  for (const word of value.split(/\s+/)) {
    if (/^localhost$/i.test(word)) return true;
    if (ADDRESS_WORD.test(word) || IPV6_WORD.test(word)) return true;  // example.com, 10.0.0.1, ::1, [fe80::1]:80
  }
  return false;
}

/** May this text be sent to a suggestion service at all? (`pasted`: the draft came from a paste or a drop.) */
function mayAskFor(text, { pasted = false } = {}) {
  if (typeof text !== 'string' || pasted) return false;
  const value = text.trim();
  if (CONTROL.test(value) || value.startsWith('!')) return false;     // a "!d something" shortcut goes to another engine, not to this service
  const length = [...value].length;
  if (length < MIN_CHARS || length > MAX_CHARS || !/[\p{L}\p{N}]/u.test(value)) return false;
  return !looksLikeAddress(value);
}

/** May this window and tab send typed text to a service at all? Only an ordinary tab of an ordinary profile in an ordinary window: never a Private window or tab, never a Tor window or tab, never a secured workspace's tab. */
function mayAskIn({ privateMode = false, torMode = false, tab, profile } = {}) {
  if (privateMode || torMode) return false;
  if (!tab || tab.privacy) return false;                 // 'private', 'tor' and 'secured' tabs
  return Boolean(profile) && !profile.private && !profile.tor;
}

const hostOf = template => { try { return new URL(String(template).replace('%s', 'x')).hostname.toLowerCase(); } catch { return ''; } };
const serviceById = id => SERVICES.find(service => service.id === id) || null;
const serviceForHost = host => SERVICES.find(service => service.hosts.includes(host)) || null;

/**
 * Where suggestions would come from, for these settings and engines. Returns
 *   { id, name, template }                   a service to ask (`name` is what the list's label and Settings' plain line say),
 *   { none: 'off' | 'engine' | 'service' | 'custom', engineName? }   nothing to ask, and why.
 * `settings`: { engineSuggestions, engineSuggestionsFrom, engineSuggestionsService, engineSuggestionsAddress }.
 * `providers`: { defaultId, engines: [{ id, name, template, suggest? }] } (the profile's effective list).
 */
function chooseSource(settings, providers) {
  if (!settings || settings.engineSuggestions !== true) return { none: 'off' };
  const from = settings.engineSuggestionsFrom || 'engine';
  if (from === 'service') {
    const service = serviceById(settings.engineSuggestionsService);
    return service ? { id: service.id, name: service.name, template: service.url } : { none: 'service' };
  }
  if (from === 'custom') {
    try { const template = suggestTemplate(settings.engineSuggestionsAddress); return { id: 'custom', name: hostOf(template).replace(/^www\./, ''), template }; } catch { return { none: 'custom' }; }
  }
  const engine = providers?.engines?.find(item => item.id === providers.defaultId) || providers?.engines?.[0];
  if (!engine) return { none: 'engine' };
  if (engine.suggest) { try { return { id: `engine:${engine.id}`, name: engine.name, template: suggestTemplate(engine.suggest) }; } catch { return { none: 'engine', engineName: engine.name }; } }
  const service = serviceForHost(hostOf(engine.template));
  return service ? { id: service.id, name: service.name, template: service.url } : { none: 'engine', engineName: engine.name };
}

/** The plain-text suggestions of a reply in the OpenSearch shape ["typed", ["one", "two", ...], ...]; anything else gives []. Never the typed text itself, never twice. Up to 10 are kept so the list, which shows at most 5, can still fill its group when some are already shown from history (src/ui/addressSuggestions.ts withEngineSuggestions). */
function parseReply(text, typed = '') {
  let data;
  try { data = JSON.parse(String(text).slice(0, MAX_BYTES)); } catch { return []; }
  if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
  const own = String(typed).trim().replace(/\s+/g, ' ').toLocaleLowerCase(), seen = new Set(own ? [own] : []), items = [];
  for (const raw of data[1]) {
    if (typeof raw !== 'string') continue;
    const item = raw.replace(/\s+/g, ' ').trim(), key = item.toLocaleLowerCase();
    if (!item || item.length > MAX_ITEM_CHARS || CONTROL.test(item) || seen.has(key)) continue;
    seen.add(key); items.push(item);
    if (items.length === MAX_CANDIDATES) break;
  }
  return items;
}

/** The address a typed text is sent to: the template with the text percent-encoded where %s stands. */
function suggestionUrl(template, text) {
  return suggestTemplate(template).replace('%s', encodeURIComponent(String(text).trim().replace(/\s+/g, ' ')).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase()));
}

/**
 * The production transport: Electron's `net` on a clean session. `ready()` resolves to that session once its route (the person's proxy) is confirmed.
 * `userAgent(session)` is the user agent to send. Rejects on any failure; the caller turns that into "nothing shows".
 */
function electronTransport({ net, ready, userAgent, languages = () => '' }) {
  return function transport(url, { signal, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, accept = 'application/x-suggestions+json, application/json;q=0.9, */*;q=0.1' } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false, request = null, timer = null, hops = 0, size = 0;
      const chunks = [], start = new URL(url);
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); if (error) reject(error); else resolve(value); };
      const stop = () => { finish(Object.assign(new Error('cancelled'), { code: 'ERR_CANCELLED' })); try { request?.abort(); } catch { /* already over */ } };
      timer = setTimeout(() => { finish(Object.assign(new Error('timeout'), { code: 'ERR_TIMEOUT' })); try { request?.abort(); } catch { /* already over */ } }, timeoutMs);
      timer.unref?.();
      if (signal?.aborted) { stop(); return; }
      signal?.addEventListener('abort', stop, { once: true });
      Promise.resolve().then(ready).then(session => {
        if (settled) return;
        request = net.request({ url, method: 'GET', session, credentials: 'omit', useSessionCookies: false, redirect: 'manual', referrerPolicy: 'no-referrer' });
        request.setHeader('User-Agent', userAgent(session));
        request.setHeader('Accept', accept);
        const language = languages(); if (language) request.setHeader('Accept-Language', language);
        request.on('redirect', (_status, _method, location) => {
          try {
            const target = new URL(location);
            // The typed text is in the address: it may only follow a redirect inside the same service (the same host, or www. of it), still over https.
            const same = target.protocol === 'https:' && !target.username && !target.password && (target.hostname === start.hostname || target.hostname === 'www.' + start.hostname || 'www.' + target.hostname === start.hostname);
            if (!same || ++hops > MAX_REDIRECTS) throw new Error('redirect');
            request.followRedirect();
          } catch (error) { finish(error); try { request.abort(); } catch { /* already over */ } }
        });
        request.on('response', response => {
          if (response.statusCode !== 200) { finish(Object.assign(new Error('status ' + response.statusCode), { code: 'ERR_STATUS' })); try { request.abort(); } catch { /* already over */ } return; }
          response.on('data', chunk => { size += chunk.length; if (size > maxBytes) { finish(Object.assign(new Error('too large'), { code: 'ERR_SIZE' })); try { request.abort(); } catch { /* already over */ } return; } chunks.push(chunk); });
          response.on('end', () => finish(null, { status: 200, text: Buffer.concat(chunks).toString('utf8') }));
          response.on('error', error => finish(error));
        });
        request.on('error', error => finish(error));
        request.end();
      }, error => finish(error));
    });
  };
}

/**
 * `transport(url, { signal })` answers { status, text } (Electron's net in production, a local HTTPS server in tests).
 * `ask({ text, source })` -> { service: { id, name }, items } | null. At most one request is in flight: a new `ask` cancels the one before it
 * (that one answers null). Nothing is cached and nothing is written anywhere here.
 */
function createSearchSuggest({ transport }) {
  let current = null;
  function cancel() { if (current) { current.abort(); current = null; } }
  async function ask({ text, source }) {
    cancel();
    if (!source || !source.template || !mayAskFor(text)) return null;
    let url; try { url = suggestionUrl(source.template, text); } catch { return null; }
    const controller = new AbortController(); current = controller;
    try {
      const reply = await transport(url, { signal: controller.signal, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
      if (controller.signal.aborted) return null;
      const items = parseReply(reply?.text ?? '', text);
      return items.length ? { service: { id: source.id, name: source.name }, items } : null;
    } catch { return null; } finally { if (current === controller) current = null; }
  }
  return { ask, cancel };
}

module.exports = { mayAskIn, SERVICES, MIN_CHARS, MAX_CHARS, MAX_ROWS, MAX_CANDIDATES, TIMEOUT_MS, MAX_BYTES, looksLikeAddress, mayAskFor, chooseSource, parseReply, suggestionUrl, electronTransport, createSearchSuggest, serviceById, serviceForHost, hostOf };
