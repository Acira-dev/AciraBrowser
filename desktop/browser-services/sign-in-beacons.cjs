'use strict';
// First-party beacons that the big sign-in pages fire for themselves and that the privacy lists also match (EasyPrivacy has
// "/generate_204?$image"). Chrome never blocks them, and a sign-in page that sees its own connectivity beacon fail is one more reason
// for it to treat the browser as tampered with, so they pass the tracker filter. Only the exact sign-in host and path qualify; the
// tracker filter keeps judging every other request, including the same path on any other host.
const BEACONS = Object.freeze([
  /^https:\/\/accounts\.google\.com\/generate_204(?:[?#]|$)/i
]);
function isSignInBeacon(url) { const text = String(url || ''); return BEACONS.some(pattern => pattern.test(text)); }

// First-party warm-ups that these pages declare as <link rel="prefetch"> (Sec-Purpose: prefetch). Acira cancels speculative prefetch everywhere
// (content-blocking.cjs, quietRequest), which also cancelled these two; neither is on any filter list. Chrome loads both, so they pass:
//   - https://login.live.com/Me.htm?v=N: Microsoft's cross-site sign-in state frame, prefetched by login.microsoftonline.com and the Bing and
//     Microsoft account pages so the personal-account hop is fast;
//   - https://r.bing.com/rp/<hash>.br.css: Bing's own static stylesheets for the other result views (images, videos, maps ...), prefetched by the
//     results page.
// Both are public static files that any page can already load with an ordinary request, so letting a prefetch of exactly them through opens no
// new channel. Only the exact host and path shape qualify (a plain prefetch only, never a prerender); every other speculative request is still cancelled.
const PREFETCHES = Object.freeze([
  /^https:\/\/login\.live\.com\/Me\.htm(?:\?v=\d{1,3})?$/i,
  /^https:\/\/r\.bing\.com\/rp\/[A-Za-z0-9_-]{8,64}\.br\.css$/i
]);
function isSignInPrefetch(url, purpose) {
  if (!/^\s*prefetch\s*$/i.test(String(purpose || ''))) return false;
  const text = String(url || '');
  return PREFETCHES.some(pattern => pattern.test(text));
}
module.exports = { isSignInBeacon, isSignInPrefetch, BEACONS, PREFETCHES };
