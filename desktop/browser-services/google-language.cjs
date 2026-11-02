'use strict';
// Google picks the page language from the network address when it has no better signal, so a fresh profile can get a French page in an English
// browser (seen in Round 3 on a Lebanese address, with Accept-Language already English). Research (docs/launch/GOOGLE_WEBSITE_LANGUAGE.md): Brave has
// no Google-specific handling that I could find (its community threads about a wrong Google language end without a fix), Helium only reduces the
// Accept-Language header, and Chrome gets its answer from the signed-in account or the PREF cookie. The known remedy, also used by the Firefox add-on
// "Google Language Lock", is Google's public `hl` parameter. So Acira asks the way every Google link can, with `hl` taken from the person's website
// language. Rules, all of which keep this narrow and honest:
//  - only a top-level GET to Google's own home page or search results (google.com, google.co.uk, google.com.lb, ...), over https;
//  - only when the URL has no `hl` already, and the person has not chosen on Google: no PREF cookie that carries `hl`, and not signed in
//    (an account has its own language setting);
//  - nothing else changes: no cookie is written or forged, no header is added, other requests and other Google pages are untouched; the request is
//    the same one a link ending in `&hl=en` would make.
// The language is the first one the profile's website language sends (the chosen one, or the system's first language; Tor and private windows follow
// their own rules in website-languages.cjs).
// R6: this hook is the only place `hl` is added. Searches typed in the address bar arrive here too, in Chromium's own form (q=…&sourceid=chrome&ie=UTF-8,
// src/runtime/searchLanguage.ts), so a typed search and the same search pasted from Chrome are one request with one language rule.
const HOST = /^(?:www\.)?google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/;
const SIGNED_IN = new Set(['SID', '__Secure-1PSID', '__Secure-3PSID', 'SAPISID']);
const PAGES = new Set(['/', '/search']);

/** `en-US` -> `en`; Google wants the region only where the language needs it (pt-BR, zh-CN, zh-TW). Anything unusable gives ''. */
function hlFor(tag) {
  if (typeof tag !== 'string') return '';
  const parts = tag.split('-'), language = parts[0].toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return '';
  const region = (parts.find((part, index) => index > 0 && /^[A-Za-z]{2}$/.test(part)) || '').toUpperCase();
  if (['pt-BR', 'pt-PT', 'zh-CN', 'zh-TW', 'zh-HK'].includes(language + '-' + region)) return language + '-' + region;
  return language;
}

/** The URL to go to instead, or null when nothing should change. Pure; the cookie rules are applied by `attach`. */
function target(url, hl) {
  if (!hl) return null;
  let parsed; try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !HOST.test(parsed.hostname) || !PAGES.has(parsed.pathname) || parsed.searchParams.has('hl')) return null;
  // Appended to the raw query so the person's own search text is not re-encoded.
  parsed.search = (parsed.search ? parsed.search + '&' : '?') + 'hl=' + encodeURIComponent(hl);
  return parsed.href;
}

/** The person already chose a language on Google, or is signed in (the account decides). */
const hasOwnChoice = (cookies) => cookies.some((cookie) => SIGNED_IN.has(cookie.name) || (cookie.name === 'PREF' && /(?:^|&)hl=/.test(String(cookie.value))));

function attach(session, pipeline, languages) {
  pipeline.useBefore(async (details) => {
    if (details.resourceType !== 'mainFrame' || details.method !== 'GET') return {};
    let next; try { next = target(details.url, hlFor(languages()[0])); } catch { return {}; }
    if (!next) return {};
    try { if (hasOwnChoice(await session.cookies.get({ url: details.url }))) return {}; } catch { return {}; }
    return { redirectURL: next };
  });
}
module.exports = { attach, target, hlFor, hasOwnChoice };
