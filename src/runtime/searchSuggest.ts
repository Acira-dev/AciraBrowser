import table from '../../desktop/suggest-services.json';
import type { SearchProviders } from './searchProviders';

/**
 * Beta 14, the interface's side of search suggestions from the search engine (opt-in; Settings, Search). Main (desktop/search-suggest.cjs) is what sends
 * anything, and it checks every rule again; this module is the same address rule and source choice for the interface, so it asks for nothing main would refuse,
 * and so Settings can say, in plain words, where typed text would go. tests/search-suggest.test.ts checks that the two agree on a table of texts.
 */
export interface SuggestService { id: string; name: string; url: string; hosts: string[] }
export const SUGGEST_SERVICES: readonly SuggestService[] = table.services;

export const SUGGEST_MIN_CHARS = 2, SUGGEST_MAX_CHARS = 100, SUGGEST_MAX_ROWS = 5;
/** The wait after the last key before the service is asked (the plan: about 150 ms). */
export const SUGGEST_WAIT_MS = 150;

const ADDRESS_WORD = /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+(?::\d+)?(?:[/?#].*)?$/u;
const IPV6_WORD = /^\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?(?::\d+)?$/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** Text that looks like a web address, a file path, an acira:// page, an IP address or localhost is never a search to send. */
export function looksLikeAddress(text: string): boolean {
  const value = text.trim();
  if (/^[a-z][a-z0-9+.-]*:\S/i.test(value)) return true;
  if (/[\\/]/.test(value)) return true;
  if (/@[^\s@]+\.[^\s@]+/.test(value)) return true;
  for (const word of value.split(/\s+/)) {
    if (/^localhost$/i.test(word)) return true;
    if (ADDRESS_WORD.test(word) || IPV6_WORD.test(word)) return true;
  }
  return false;
}

/** May this text be sent to a suggestion service? Not before 2 characters, not while it is a paste, not an address, a path or a "!shortcut". */
export function mayAskFor(text: string, { pasted = false }: { pasted?: boolean } = {}): boolean {
  if (typeof text !== 'string' || pasted) return false;
  const value = text.trim();
  if (CONTROL.test(value) || value.startsWith('!')) return false;
  const length = [...value].length;
  if (length < SUGGEST_MIN_CHARS || length > SUGGEST_MAX_CHARS || !/[\p{L}\p{N}]/u.test(value)) return false;
  return !looksLikeAddress(value);
}

const MARKER = 'ACIRA_SUGGEST_PLACEHOLDER_41B7';
/** A suggestion address is https with exactly one %s, in the path or the query (never only the fragment, which is never sent), and a fixed host. Returns it normalised, or null. */
export function validSuggestAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value) || value.includes(MARKER) || value.split('%s').length !== 2) return null;
  let url: URL;
  try { url = new URL(value.replace('%s', MARKER)); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.origin.toLowerCase().includes(MARKER.toLowerCase())) return null;
  if (![url.pathname, url.search].some(part => part.includes(MARKER))) return null;
  return url.href.replace(MARKER, '%s');
}

const hostOf = (template: string) => { try { return new URL(template.replace('%s', 'x')).hostname.toLowerCase(); } catch { return ''; } };
export const suggestServiceById = (id: string): SuggestService | undefined => SUGGEST_SERVICES.find(service => service.id === id);
export const suggestServiceForHost = (host: string): SuggestService | undefined => SUGGEST_SERVICES.find(service => service.hosts.includes(host));

export interface SuggestSettings { engineSuggestions?: boolean; engineSuggestionsFrom?: 'engine' | 'service' | 'custom'; engineSuggestionsService?: string; engineSuggestionsAddress?: string }
export type SuggestSource = { id: string; name: string; template: string } | { none: 'off' | 'engine' | 'service' | 'custom'; engineName?: string };
export const hasSuggestSource = (source: SuggestSource): source is { id: string; name: string; template: string } => 'template' in source;

/** Where typed text would go for these settings and this engine list, or why nowhere. The same choice main makes. */
export function chooseSuggestSource(settings: SuggestSettings, providers: SearchProviders): SuggestSource {
  if (settings.engineSuggestions !== true) return { none: 'off' };
  const from = settings.engineSuggestionsFrom || 'engine';
  if (from === 'service') {
    const service = suggestServiceById(settings.engineSuggestionsService || '');
    return service ? { id: service.id, name: service.name, template: service.url } : { none: 'service' };
  }
  if (from === 'custom') {
    const template = validSuggestAddress(settings.engineSuggestionsAddress);
    return template ? { id: 'custom', name: hostOf(template).replace(/^www\./, ''), template } : { none: 'custom' };
  }
  const engine = providers.engines.find(item => item.id === providers.defaultId) || providers.engines[0];
  if (!engine) return { none: 'engine' };
  if (engine.suggest) {
    const template = validSuggestAddress(engine.suggest);
    return template ? { id: `engine:${engine.id}`, name: engine.name, template } : { none: 'engine', engineName: engine.name };
  }
  const service = suggestServiceForHost(hostOf(engine.template));
  return service ? { id: service.id, name: service.name, template: service.url } : { none: 'engine', engineName: engine.name };
}

/** The search address of a results page, back to the text that was searched ("sad songs" for the default engine's results page of it), or null. */
export function queryOfSearchUrl(url: string, providers: SearchProviders): string | null {
  for (const engine of providers.engines) {
    const at = engine.template.indexOf('%s');
    if (at < 0) continue;
    const head = engine.template.slice(0, at), tail = engine.template.slice(at + 2);
    if (!url.startsWith(head)) continue;
    let rest = url.slice(head.length);
    if (tail) { const end = rest.indexOf(tail); if (end < 0) continue; rest = rest.slice(0, end); }
    else { const end = rest.search(/[&#]/); if (end >= 0) rest = rest.slice(0, end); }
    try { const text = decodeURIComponent(rest.replace(/\+/g, ' ')).trim(); if (text) return text; } catch { /* not a query */ }
  }
  return null;
}
