'use strict';
// Lazy answering of cookie banners (Beta 14 speed pass, RAM). DuckDuckGo autoconsent's instance and its ~500 rules cost every page's process 3-4 MB at load
// (1-2 MB still after a garbage collection), though most pages have no consent tool at all. A page's MAIN FRAME now gets, instead of the rules:
//   - prehide: exactly the selector list the library would hide at DOMContentLoaded (its prehideElements: the Didomi line, then every rule that has
//     prehideSelectors and runs here), so the page hides the same boxes at the same moment as before;
//   - detect: the CSS that one of those rules (or one of the library's coded consent tools) must find before the library can say "this is my tool"
//     (the first step of each rule's detectCmp); xpath: the same for the two rules that ask with an xpath;
//   - evals: the library's own page-world snippets a rule asks first (run in the page's world, as the library runs them);
//   - text: the words the Admiral notice must contain (its coded check reads text, not CSS);
//   - now: true when a rule here can detect without CSS (the library is then loaded at once, as before).
// The page (autoconsent-preload-entry.cjs) checks `detect` on the library's own schedule and loads the library and its rules only when it finds something:
// the library then runs exactly as before, from its own first detection. Frames other than the main frame keep the full rules (they are few and small).
// The coded consent tools below are the library's dynamicCMPs (17.2.0); tests/autoconsent-lazy.test.cjs reads them back from the library and fails if they differ.
const GLOBAL_HIDDEN = '#didomi-popup,.didomi-popup-container,.didomi-popup-notice,.didomi-consent-popup-preferences,#didomi-notice,.didomi-popup-backdrop,.didomi-screen-medium';
const STEP_VERSION = 3;
const ADMIRAL_CARD = 'div > div[class*=Card] > div[class*=Frame] > div[class*=Pills] > button[class*=Pills__StyledPill]';
const CODED = Object.freeze([
  {name: 'TrustArc-top', urlPattern: '', prehide: ['.trustarc-banner-container', '.truste_popframe,.truste_overlay,.truste_box_overlay,#truste-consent-track'], detect: ['#truste-show-consent,#truste-consent-track']},
  {name: 'Cybotcookiebot', urlPattern: '', prehide: ['#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,#dtcookie-container,#cookiebanner,#cb-cookieoverlay,.modal--cookie-banner,#cookiebanner_outer,#CookieBanner'], detect: ['#CybotCookiebotDialog']},
  {name: 'Sourcepoint-frame', urlPattern: '', prehide: ["div[id^='sp_message_container_'],.message-overlay", '#sp_privacy_manager_container'], detect: [], spHosts: true},
  {name: 'consentmanager.net', urlPattern: '', prehide: ['#cmpbox,#cmpbox2'], detect: ['#cmpbox']},
  {name: 'Evidon', urlPattern: '', prehide: [], detect: ['#_evidon_banner']},
  {name: 'Onetrust', urlPattern: '', prehide: ['#onetrust-banner-sdk,#onetrust-consent-sdk,.onetrust-pc-dark-filter,.js-consent-banner'], detect: ['#onetrust-banner-sdk', '#onetrust-pc-sdk']},
  {name: 'Klaro', urlPattern: '', prehide: ['.klaro'], detect: ['.klaro > .cookie-modal', '.klaro > .cookie-notice']},
  {name: 'Uniconsent', urlPattern: '', prehide: ['.unic', '.modal:has(.unic)'], detect: ['.unic .unic-box,.unic .unic-bar,.unic .unic-modal']},
  {name: 'Conversant', urlPattern: '', prehide: ['.cmp-root'], detect: ['.cmp-root .cmp-receptacle']},
  {name: 'tiktok.com', urlPattern: 'tiktok', prehide: [], detect: ['tiktok-cookie-banner']},
  {name: 'Admiral', urlPattern: '', prehide: [], detect: [ADMIRAL_CARD], text: ['Your Privacy', 'VRM', 'Admiral']}
]);
/** Sourcepoint's coded rule answers by the frame's own address (its message and privacy manager pages): such a main frame loads the library at once. */
const sourcepointPage = url => /(^|\.)sp-prod\.net$/.test(url.hostname) || /(^|\.)privacy-mgmt\.com$/.test(url.hostname);

/** What a rule's first detection step needs before it can be true: {css: [...], evals: [...]} (any of them), or null when that step is neither CSS nor a
 *  named snippet of the library (the library is then loaded at once). A snippet is run in the page's own world, as the library itself runs it. */
function firstStepNeeds(step) {
  if (!step || typeof step !== 'object') return null;
  if (Array.isArray(step.any)) { const all = {css: [], evals: []}; for (const s of step.any) { const need = firstStepNeeds(s); if (!need) return null; all.css.push(...need.css); all.evals.push(...need.evals); } return all; }
  if (typeof step.eval === 'string') return {css: [], evals: [step.eval]};
  for (const key of ['exists', 'visible', 'waitFor', 'waitForVisible']) {
    const value = step[key];
    if (typeof value === 'string') return {css: [value], evals: []};
    if (Array.isArray(value) && typeof value[0] === 'string') return {css: [value[0]], evals: []};   // a selector chain into shadow roots: its first part is in the page
  }
  return null;
}
const runsHere = (runContext, href) => { const ctx = {main: true, frame: false, urlPattern: '', ...(runContext || {})}; return ctx.main !== false && (!ctx.urlPattern || !!href.match(ctx.urlPattern)); };

function createLazyAnswering({rules, library = () => require('@duckduckgo/autoconsent'), disabledCmps = [], enableCosmeticRules = false, enableGeneratedRules = true, limit = 64} = {}) {
  const cache = new Map();
  const keep = rule => !disabledCmps.includes(rule.name) && (enableCosmeticRules || !rule.cosmetic) && (enableGeneratedRules || !String(rule.name).startsWith('auto_'));
  /** What a page's main frame at `href` gets instead of the rules, or null (not a website). */
  function lazyFor(href) {
    let url; try { url = new URL(href); } catch { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;
    const key = url.origin + url.pathname;
    if (cache.has(key)) { const hit = cache.get(key); cache.delete(key); cache.set(key, hit); return hit; }
    // the rules as an object (autoconsent-rules.cjs compactFor), not the string a frame would be sent: no 190 KB stringify and parse per address, no string cached
    const compact = typeof rules.compactFor === 'function' ? rules.compactFor(href, true) : (text => text ? JSON.parse(text) : null)(rules.rulesFor(href, true)); if (!compact) return null;
    const decoded = library().decodeRules(compact), list = Array.isArray(decoded) ? decoded : (decoded.autoconsent || []);
    const prehide = [GLOBAL_HIDDEN], css = new Set(), xpath = new Set(), evals = new Set(), text = []; let now = sourcepointPage(url);
    for (const rule of CODED) {
      if (!keep(rule) || !runsHere({urlPattern: rule.urlPattern}, href)) continue;
      prehide.push(...rule.prehide); for (const s of rule.detect) css.add(s); if (rule.text) text.push(rule.text);
    }
    for (const rule of list) {
      if ((rule.minimumRuleStepVersion || 1) > STEP_VERSION || !keep(rule) || !runsHere(rule.runContext, href)) continue;
      if (Array.isArray(rule.prehideSelectors)) prehide.push(...rule.prehideSelectors);
      const need = firstStepNeeds((rule.detectCmp || [])[0]);
      if (!need) { now = true; continue; }
      for (const s of need.css) { if (s.startsWith('xpath/')) xpath.add(s.slice(6)); else css.add(s); }
      for (const name of need.evals) { const snippet = library().evalSnippets?.[name]; if (typeof snippet === 'function') evals.add(`(${String(snippet)})()`); else now = true; }
    }
    const value = {prehide: prehide.join(','), detect: [...css], xpath: [...xpath], evals: [...evals], text, now};
    cache.set(key, value); if (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  }
  /** Beta 14 page-load pass: the same work once, ahead of the first page (optional-filtering.cjs calls it at a quiet moment after start), for an address no
   *  page has; nothing is left in the cache. Once per process. */
  let warmed = false;
  function warm() {
    if (warmed) return true; warmed = true;
    try { if (typeof rules.warm === 'function') rules.warm(); const href = 'https://warm-up.invalid/', value = lazyFor(href); cache.delete(new URL(href).origin + new URL(href).pathname); return value !== undefined; } catch { return false; }
  }
  return {lazyFor, warm};
}
/** What a frame asks for at document start (main's acira:autoconsent-setup answer; the cookie-banner Electron test hands out the same): a website's main frame
 *  gets {config, lazy} unless one of its rules can detect without CSS; any other frame, or such a main frame, gets {config, rules}; null when no rules apply. */
function setupFor({rules, lazyAnswers, url, main}) {
  const lazy = main ? lazyAnswers.lazyFor(url) : null;
  if (lazy && !lazy.now) return {config: rules.config(), lazy};
  const list = rules.rulesFor(url, main);
  return list ? {config: rules.config(), rules: list} : null;
}
module.exports = {createLazyAnswering, setupFor, firstStepNeeds, CODED, GLOBAL_HIDDEN, ADMIRAL_CARD, STEP_VERSION};
