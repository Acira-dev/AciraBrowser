/** The Google search URL Acira builds when the person searches from the address bar, the new tab search box or a search shortcut.
 *  It is Chromium's own form (`q=…&sourceid=chrome&ie=UTF-8`, see asBrowserSearch) and carries no page language: the network hook in
 *  desktop/browser-services/google-language.cjs adds `hl=<the profile's first website language>` to every top-level Google search, typed or pasted,
 *  unless the person already chose on Google (a PREF cookie with `hl`, or signed in). R6: a typed search used to force `hl` past that choice, so the
 *  same search typed and pasted asked Google different things (typed "youtube" lost https://www.youtube.com and its sitelinks; pasting Chrome's URL
 *  into the same profile kept them). Other engines and the addresses the person types are untouched. */
const GOOGLE_HOST = /^(?:www\.)?google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/;
const WITH_REGION = ['pt-BR', 'pt-PT', 'zh-CN', 'zh-TW', 'zh-HK'];

/** `en-US` -> `en`; Google wants the region only where the language needs it (pt-BR, zh-CN, zh-TW). Anything unusable gives ''. */
export function googleHl(tag: unknown): string {
  if (typeof tag !== 'string') return '';
  const parts = tag.split('-'), language = parts[0].toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return '';
  const region = (parts.find((part, index) => index > 0 && /^[A-Za-z]{2}$/.test(part)) || '').toUpperCase();
  return WITH_REGION.includes(language + '-' + region) ? language + '-' + region : language;
}

/** Google's own results page (`/search` on google.com, google.co.uk, google.com.lb ...) over https, or null. */
function googleResults(url: string): URL | null {
  let parsed: URL; try { parsed = new URL(url); } catch { return null; }
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && GOOGLE_HOST.test(parsed.hostname) && parsed.pathname === '/search' ? parsed : null;
}

/** True for Google's own results page with no `hl` yet. */
export function isGoogleSearch(url: string): boolean {
  const parsed = googleResults(url);
  return !!parsed && !parsed.searchParams.has('hl');
}

/** Chromium's own Google engine (components/search_engines/prepopulated_engines.json, the search URL Chrome, Brave, Vivaldi and Helium use)
 *  ends a typed search with `sourceid=chrome&ie=UTF-8`: Google's mark of a search typed in a browser's address bar, and the encoding of `q`.
 *  Without them Google takes a navigational search such as "youtube" as a bare URL request and may rank it differently (R6: channel cards instead
 *  of https://www.youtube.com and its sitelinks). Acira sends the same two parameters, nothing else: no suggestion statistics (`gs_lcrp`, `oq`),
 *  no client id, no RLZ. A URL that already names a `sourceid` is left as it is. */
export const CHROMIUM_GOOGLE_PARAMS = 'sourceid=chrome&ie=UTF-8';
export function asBrowserSearch(url: string): string {
  const parsed = googleResults(url);
  if (!parsed || parsed.searchParams.has('sourceid')) return url;
  parsed.search = (parsed.search ? parsed.search + '&' : '?') + CHROMIUM_GOOGLE_PARAMS;
  return parsed.href;
}

/** The search URL with the page language added, or the same URL when it is not a Google search, already names a language, or no language is known.
 *  Appended to the raw query so the person's own search text is not re-encoded. Typed searches no longer use it (googleSearchUrl); it states the
 *  rule the network hook applies, and the tests hold both to the same answer. */
export function withSearchLanguage(url: string, websiteLanguage: unknown): string {
  const hl = googleHl(websiteLanguage);
  if (!hl || !isGoogleSearch(url)) return url;
  const parsed = new URL(url);
  parsed.search = (parsed.search ? parsed.search + '&' : '?') + 'hl=' + encodeURIComponent(hl);
  return parsed.href;
}

/** A Google search Acira builds from typed text (address bar, new tab box, search shortcuts): Chromium's search URL and nothing more. The page
 *  language is the network hook's to add, under the same rules as a pasted Google link, so typed and pasted searches are the same request. */
export function googleSearchUrl(url: string): string {
  return asBrowserSearch(url);
}

/** Where the main process finds a profile's first website language (the reducer runs there). Unset in a plain browser tab and in tests: no language, no change. */
let source: (browserProfileId?: string) => string = () => '';
export function setWebsiteLanguageSource(next: ((browserProfileId?: string) => string) | null): void { source = next || (() => ''); }
export function websiteLanguageFor(browserProfileId?: string): string {
  try { const tag = source(browserProfileId); return typeof tag === 'string' ? tag : ''; } catch { return ''; }
}
