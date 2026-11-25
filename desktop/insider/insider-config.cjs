'use strict';
// Beta 14 AH: where the Insider programme's server is, and which public key(s) its certificates are signed with. Until BOTH an address and a key are written here the whole programme is HIDDEN: no sheet, no row in
// Settings or the profile viewer, no request, no event, and an activation link does nothing. Nothing here is a secret: an address and public keys only (the server's private signing
// key is never in the app or in any repository; tests/insider-security.test.cjs and the public-source audit check that).
//   endpoint  the functions' base address, https (e.g. https://<project>.supabase.co/functions/v1/): the browser adds insider-activate, insider-redeem, insider-invite,
//             insider-invites, insider-move-code and insider-move.
//   keys      [{kid, publicKey}]: the server's Ed25519 public key(s), 32 raw bytes in base64url; `kid` is what a certificate's header names (a rotation = a second entry; old
//             certificates stay valid while their key is listed).
//   feed      the Insider update feed's base address (same layout as the public feed's folders), asked only while the Insider channel is on and the certificate is valid. Without it
//             the Updates row is not offered.
// A test profile (ACIRA_BROWSER_TEST_DATA) never uses what is written here: only what QA names itself, plain http allowed on 127.0.0.1:
//   ACIRA_INSIDER_ENDPOINT, ACIRA_INSIDER_FEED, ACIRA_INSIDER_PUBLIC_KEY (`kid:publicKey`, several separated by commas), ACIRA_INSIDER_AUTO_ENROLL ('1' = enroll automatically), ACIRA_INSIDER_INVITES_OPEN ('1' = invites are open).
// (The 16:40 "Insider build" with a build-time activation key is gone: the final design, 15 Nov 18:07, activates with a personal link instead, and no build carries any secret.)
const { checkedEndpoint } = require('../browser-services/metrics.cjs');

// The Insider server (16 Nov 2026): its own server project, ONE Edge Function `insider` under which the six names live. The key below is the
// PUBLIC half of the certificate key made inside that project (its private half never left it).
const SHIPPED = Object.freeze({
  endpoint: 'https://lzdndhalljkmqabbtruv.supabase.co/functions/v1/insider/',
  // The Insider update feed (rule 8): the same function, `feed/<channel file>`, each request signed for its own path; it is filled at publish time.
  feed: 'https://lzdndhalljkmqabbtruv.supabase.co/functions/v1/insider/feed/',
  keys: Object.freeze([Object.freeze({ kid: 'insider-2026-11', publicKey: 'DDXEvzCyVMhYG7Ywl6N3LOchj_IE5MlLM344y87ei4U' })]),
  // OFF from Beta 14.4 (the team's logic, 24 Nov: "when people download the 14.4 public one ... new insiders ... we're gonna give them keys"): a profile no longer enrols itself. The first Insider builds (14.0 to 14.3, the team 16 Nov)
  // asked for the next number once, quietly; on a public build that would make every profile an Insider. A profile that already holds a pass keeps it untouched; new Insiders enter the key they are given (About > Extras, the profile menu's
  // "Enter Insider code", a personal link). The mechanism stays in insider-service.cjs (autoEnroll) behind this flag.
  autoEnroll: false,
  // Invites are OPEN from the public 14.4 (reported 24 Nov: "a member invites a friend; the friend enters the code and gets a number and a card"). A Founding Contributor (No. 1 to 100) has 3 codes, an Insider (No. 101 and up) 2; the server owns the counts and has its own switch
  // (insider_enrollment.invites_open): while it is shut, an invite answers none_left (with `closed` where the function passes it on) and the screen stays calm. Closed in the first Insider build (the reference design B1, 17 Nov): this one flag.
  invitesOpen: true,
});

const parseKeys = (text) => String(text || '').split(',').map((item) => item.trim()).filter(Boolean).map((item) => { const at = item.indexOf(':'); return at > 0 ? { kid: item.slice(0, at), publicKey: item.slice(at + 1) } : null; }).filter(Boolean);

/** The programme's settings: {endpoint, feed, keys, autoEnroll, invitesOpen, allowLocal}. An address that is not https (or plain http on this computer in a test) becomes ''. */
function insiderConfig(env = process.env, shipped = SHIPPED) {
  const test = Boolean(env.ACIRA_BROWSER_TEST_DATA);
  const pick = (value) => checkedEndpoint(value || '', { allowLocal: test });
  const withSlash = (value) => (value ? (value.endsWith('/') ? value : `${value}/`) : '');
  return {
    endpoint: withSlash(pick(test ? env.ACIRA_INSIDER_ENDPOINT : shipped.endpoint)),
    feed: withSlash(pick(test ? env.ACIRA_INSIDER_FEED : shipped.feed)),
    keys: test ? parseKeys(env.ACIRA_INSIDER_PUBLIC_KEY) : [...shipped.keys],
    autoEnroll: test ? env.ACIRA_INSIDER_AUTO_ENROLL === '1' : shipped.autoEnroll === true,
    invitesOpen: test ? env.ACIRA_INSIDER_INVITES_OPEN === '1' : shipped.invitesOpen === true,
    allowLocal: test,
  };
}

module.exports = { insiderConfig, SHIPPED, parseKeys };
