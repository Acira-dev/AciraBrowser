import type { InternalPage,SearchEngine,TabContentKind } from './types';
import { effectiveProviders,resolveSearch } from './searchProviders';
import type { SearchProviders } from './searchProviders';
import { googleSearchUrl } from './searchLanguage';
import { PUBLIC_SUFFIX_TLDS } from './publicSuffixTlds';


export interface NavigationTarget {url:string;contentKind:TabContentKind;query?:string;error?:string;/** A typed address that got https by default; the native layer may retry over http if the site has no secure endpoint. */httpsFirst?:boolean}
export const INTERNAL_PAGES:readonly InternalPage[]=['locked','home','history','settings','downloads','bookmarks','rewind','routines'];
const searchUrls: Record<SearchEngine, string> = { google: 'https://www.google.com/search', duckduckgo: 'https://duckduckgo.com/', bing: 'https://www.bing.com/search' };

/** The engine a typed search in this tab uses. A Tor tab always searches with DuckDuckGo (Tor Browser's default; Tor windows already do), whatever the
 *  profile's default or custom providers, so a search typed over Tor never goes to Google. */
export function searchFor(settings: { searchEngine: SearchEngine; searchProviders?: SearchProviders | null }, privacy?: string): [SearchEngine, SearchProviders | undefined] {
  return privacy === 'tor' ? ['duckduckgo', undefined] : [settings.searchEngine, settings.searchProviders ?? undefined];
}

// Schemeless development/LAN endpoints usually serve HTTP. Explicit schemes
// are never changed, including when HTTPS fails certificate validation.
function localHostname(host:string):boolean {
 const name=host.toLowerCase().replace(/\.$/,'');
 if(name==='localhost'||name.endsWith('.localhost')||name.endsWith('.local')||name==='[::1]'||/^\[(?:f[cd]|fe[89ab])/i.test(name))return true;
 const octets=name.split('.').map(Number);
 return octets.length===4&&octets.every(value=>Number.isInteger(value)&&value>=0&&value<=255)&&(octets[0]===127||octets[0]===10||octets[0]===192&&octets[1]===168||octets[0]===172&&octets[1]>=16&&octets[1]<=31||octets[0]===169&&octets[1]===254);
}

// Schemes a browser knows: typed, they stay the "only http and https" refusal rather than becoming a search.
const KNOWN_SCHEMES = /^(?:javascript|data|file|chrome|chrome-extension|chrome-untrusted|devtools|about|blob|filesystem|vbscript|view-source|mailto|tel|ftp|wss?):/i;
// Names reserved for local networks and testing (RFC 2606, 6761, 6762; ICANN's .internal), plus the common router names .lan and .home.
const LOCAL_TOP_LEVEL = new Set(['localhost', 'local', 'test', 'example', 'invalid', 'internal', 'lan', 'home']);
let topLevelNames: Set<string> | null = null;
/** A dotted word is an address when its last label is a real top-level suffix (the Public Suffix List, bundled offline), so "node.js",
 *  "next.js" and "v1.2" search while "nodejs.org", "setup.py" (Paraguay) and "bbc.co.uk" open. IP addresses always open. */
function knownTopLevel(hostname: string): boolean {
  if (hostname.startsWith('[') || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return true;
  const label = hostname.toLowerCase().replace(/\.$/, '').split('.').pop() || '';
  topLevelNames ??= new Set(PUBLIC_SUFFIX_TLDS.split(/\s+/).filter(Boolean));
  return topLevelNames.has(label) || LOCAL_TOP_LEVEL.has(label);
}

/** A Google search made from typed text is Chromium's own Google URL (searchLanguage.ts). The fourth argument, the profile's first website language,
 *  no longer changes the URL (R6): the network hook adds Google's `hl` under the same rules for typed and pasted searches. Addresses and other engines never change. */
export function resolveNavigation(input: string, engine: SearchEngine = 'google', providers?: SearchProviders, _websiteLanguage?: string): NavigationTarget {
  // Common scheme typos ("http:/example.com", "https:example.com", "http//x") mean the web address, not a search.
  const value = input.trim().replace(/^(https?):\/{0,2}(?=[^/\s:]+\.[^/\s]|localhost|\[)/i, (_all, scheme: string) => `${scheme.toLowerCase()}://`);
  if (!value || value === 'acira://new' || value === 'acira://new/') return { url: 'acira://new', contentKind: 'internal' };
  if (/^acira:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      const name = parsed.hostname.toLowerCase();
      if (INTERNAL_PAGES.includes(name as InternalPage) && (!parsed.pathname || parsed.pathname === '/')) return { url: `acira://${name}`, contentKind: 'internal' };
    } catch { /* Invalid internal inputs remain explicit errors. */ }
    return { url: 'acira://new', contentKind: 'internal', error: 'That Acira page isn’t available.' };
  }
  const hostPort = /^(?:localhost|[^\s@/?#:]+\.[^\s@/?#:]+):\d+(?:[/?#]|$)/i.test(value);
  const explicitScheme = !hostPort && /^[a-z][a-z\d+.-]*:/i.test(value);
  const explicitWeb = /^https?:\/\//i.test(value);
  // An unknown scheme without "//" is text, not an address: "site:example.com", "define:word", "re:zero", "time:12:30", "std::vector".
  if (explicitScheme && !explicitWeb && (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || KNOWN_SCHEMES.test(value))) return { url: 'acira://new', contentKind: 'internal', error: 'Acira opens only http and https addresses.' };
  const addressLike = explicitWeb || !/\s/.test(value) && (!explicitScheme && (/^(?:localhost(?::\d+)?|(?:\d{1,3}\.){3}\d{1,3}|\[[\da-f:]+\])(?:[:/?#]|$)/i.test(value) || /^[^\s@/?#]+\.[^\s@/?#]+(?:[/?#]|$)/.test(value)));
  if (addressLike) {
    try {
      const local = !explicitWeb&&localHostname(new URL(`https://${value}`).hostname);
      const parsed = new URL(explicitScheme ? value : `${local ? 'http' : 'https'}://${value}`);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('Invalid web address');
      if (parsed.username || parsed.password) return { url: 'acira://new', contentKind: 'internal', error: 'Remove the sign-in details from the address.' };
      // "3.14" or "1.2" would parse as the IPv4 address 1.0.0.2: only all four parts make a bare number an address.
      const typedHost = value.replace(/[/?#][\s\S]*$/, '').replace(/:\d+$/, ''), shortNumber = /^[\d.]+$/.test(typedHost) && !/^(?:\d{1,3}\.){3}\d{1,3}\.?$/.test(typedHost);
      if (explicitWeb || hostPort || /^[^/?#]*\//.test(value) || !shortNumber && (local || knownTopLevel(parsed.hostname))) return { url: parsed.toString(), contentKind: 'web', ...(!explicitWeb && !local && parsed.protocol === 'https:' ? { httpsFirst: true } : {}) };
    } catch { if (/^[^/?#]*\//.test(value) || hostPort || explicitWeb) return { url: 'acira://new', contentKind: 'internal', error: 'Check the web address and try again.' }; }
  }
  const bangLike = /^![a-z0-9]/i.test(value);
  if (providers || bangLike) {
    const found = resolveSearch(value, effectiveProviders(providers, engine));
    if (found && (providers || found.bangUsed)) return { url: googleSearchUrl(found.url), contentKind: 'web', query: found.query };
    if (!found && bangLike) return { url: 'acira://new', contentKind: 'internal', error: 'Enter text after the search shortcut.' };
  }
  const search = new URL(searchUrls[engine] || searchUrls.google);
  search.searchParams.set('q', value);
  return { url: googleSearchUrl(search.toString()), contentKind: 'web', query: value };
}
export function navigationTitle(url:string):string{if(url.startsWith('acira://'))return ({locked:'Locked',new:'New tab',home:'Home',history:'History',settings:'Settings',downloads:'Downloads',bookmarks:'Bookmarks',rewind:'Rewind',routines:'Tab sets'} as Record<string,string>)[url.slice(8)]||'Acira';try{return new URL(url).hostname;}catch{return 'New tab';}}
