'use strict';
// chrome_url_overrides.newtab, as an explicit choice: Settings › Extensions › "Use as New Tab page" (off by default, one extension per profile).
//
// Ported from Chromium (BSD-3-Clause), the same way Chrome does it: the extension's page is NOT drawn in a view of its own over the
// browser. A tab that goes to the New Tab address is rewritten to the extension's page and that page loads in the TAB'S OWN web contents,
// like any other page, while the address the person sees stays the New Tab's (a "virtual" address):
//   chrome/browser/extensions/extension_url_overrides.cc   HandleChromeURLOverride (the rewrite, and: the New Tab is never overridden in
//                                                          a private window), HandleChromeURLOverrideReverse (the virtual address),
//                                                          UnregisterAndReplaceOverrideForWebContents (a tab on the page goes back to the
//                                                          original page when the override goes away)
//   chrome/browser/ui/toolbar/chrome_location_bar_model_delegate.cc   ShouldDisplayURL: no address text for the New Tab (virtual) address
//   chrome/browser/ui/views/frame/contents_web_view.cc    UpdateBackgroundColor: until the page's first paint the contents show the theme's
//                                                          page colour, never white
//   chrome/browser/ui/search/new_tab_page_navigation_throttle.cc   OpenLocalNewTabPage: a New Tab page that fails to load is replaced by the
//                                                          browser's own
// (Not taken: the tab's title and icon in Acira's own tab rows. Chrome shows the page's title and the extension's icon; Acira keeps its New Tab row as it is, a design rule.)
// In the tab model the tab keeps the address acira://new and is a "web" tab (a page view exists for it, so it stacks, parks under a floating
// sidebar, sleeps, restores, finds and reloads exactly like any page). Private and Tor windows and private tabs, a tab in a split, the
// window's first tab and the setup always keep Acira's own New Tab page.

const NEW_TAB = 'acira://new';

/** Is this tab the New Tab showing an extension's page? (a page tab whose address is the New Tab's: nothing else is both) */
function isOverridePage(tab) {
 return !!tab && tab.contentKind === 'web' && tab.url === NEW_TAB;
}

/** HandleChromeURLOverride for one tab: which extension page the New Tab becomes, or null. Pure: every input is passed in.
 * `tab` may already be the page form (a web tab on the New Tab address). */
function overrideFor({tab, privateMode = false, torMode = false, split = false, setup = false, baseline = null, choice = null}) {
 // Chrome: "we never allow the new tab page to be overridden in incognito since we need to ensure users see details about what incognito is"
 if (privateMode || torMode || split || setup || !choice || !tab) return null;
 if (tab.url !== NEW_TAB || tab.error || tab.privacy || tab.private) return null;
 if (baseline && baseline.has(tab.id)) return null;
 if (typeof choice.url !== 'string' || !/^chrome-extension:\/\/[a-p]{32}\//.test(choice.url)) return null;
 return {tabId: tab.id, profileId: tab.browserProfileId, extensionId: choice.extensionId, url: choice.url};
}

const withoutPageFields = tab => {
 const {progress, requestedUrl, media, audible, sleeping, risk, onionAuth, onionLocation, ...rest} = tab;
 return rest;
};

/** The tab becomes the extension's page (a web tab), keeping its address and history. */
function toPage(tab) {
 return {...withoutPageFields(tab), contentKind: 'web', loading: false, favicon: '', error: null};
}

/** The tab goes back to Acira's own New Tab page (the override went away, or the tab entered a split). */
function toInternal(tab) {
 const last = Math.max(0, (tab.history || []).length - 1), index = Math.max(0, Math.min(Number.isInteger(tab.historyIndex) ? tab.historyIndex : 0, last));
 return {...withoutPageFields(tab), contentKind: 'internal', loading: false, favicon: '', error: null, canGoBack: index > 0, canGoForward: index < last};
}

/** The rewrite step for a whole window state (Chromium does it per navigation, in BrowserURLHandler; the tab model here is reduced as a whole, so it
 * runs after every reduction): every tab on the New Tab address is the extension's page when the override applies to it, and Acira's own page
 * when it does not. Returns the same object when nothing changes. `ctx.choiceFor(profileId)` is the profile's chosen {extensionId,url} or null;
 * `ctx.failed` holds the ids of tabs whose extension page failed to load (they stay on Acira's page, as Chrome's OpenLocalNewTabPage does). */
function normalizeTabs(state, ctx) {
 if (!state || !Array.isArray(state.tabs) || !ctx || !ctx.baseline) return state;
 const split = new Set(state.windowUi?.split?.tabIds || []);
 let changed = false;
 const tabs = state.tabs.map(tab => {
  if (tab.url !== NEW_TAB) return tab;
  const page = tab.contentKind === 'web';
  const want = ctx.failed?.has(tab.id) ? null : overrideFor({tab: page ? {...tab, error: null} : tab, privateMode: ctx.privateMode, torMode: ctx.torMode, split: split.has(tab.id), baseline: ctx.baseline, choice: ctx.choiceFor(tab.browserProfileId)});
  if (!!want === page) return tab;
  changed = true;
  return want ? toPage(tab) : toInternal(tab);
 });
 return changed ? {...state, tabs} : state;
}

/** The address a tab's page really loads: the extension's page for the New Tab (its virtual address), the tab's own address otherwise.
 * The way back is HandleChromeURLOverrideReverse: the tab model keeps the New Tab address while the page is the extension's, because a page's
 * own address only replaces the tab's when it is an http(s) one (runtime/core.ts, browser.event), so the extension page never shows as an address. */
function pageUrlOf(tab, choice) {
 return isOverridePage(tab) && choice && typeof choice.url === 'string' ? choice.url : tab.url;
}

/** The page's own title when it has one. A page with no <title> gets its address as the title (Chromium), which a tab must not wear: '' then, and the tab keeps "New tab". */
function pageTitle(title, url) {
 const text = typeof title === 'string' ? title.trim() : '';
 if (!text) return '';
 const bare = String(url || '').replace(/^[a-z][a-z\d+.-]*:\/\//i, '');
 if (text === url || text === bare || /^chrome-extension:\/\//i.test(text)) return '';
 return text.slice(0, 200);
}

/** What the New Tab's extension page may tell the tab model. Acira's own New Tab never "loads", never has a title of its own in the row (it says "New tab") and never has a
 * colour or an icon; a page that is the New Tab only because an extension fills it must not turn that into a stream of state changes (a title, loading and progress on every
 * resource, an address that is never shown): each one re-renders the whole interface, the sidebar under a resting pointer and the extension buttons included. Only what the tab
 * really shows passes (an error, back and forward, zoom, sound, a capture indicator); an address that is a website means the page left the New Tab, and then all of it counts.
 * Returns the patch to send, or null when there is nothing to say. Pure. */
function quietPatch(tab, patch) {
 if (!isOverridePage(tab) || !patch || typeof patch !== 'object') return patch;
 if (typeof patch.url === 'string' && /^https?:\/\//i.test(patch.url)) return patch;
 const out = {};
 for (const key of Object.keys(patch)) {
  if (['url', 'title', 'loading', 'progress', 'favicon', 'restored'].includes(key)) continue;
  if (key === 'siteColor' && !(patch[key] == null && tab.siteColor)) continue;   // a colour never; taking one the tab still carries away, yes
  if (tab[key] === patch[key]) continue;
  out[key] = patch[key];
 }
 return Object.keys(out).length ? out : null;
}

/** Does an extension's request for a tab ask for the New Tab page? Chrome: no address at all (chrome.tabs.create({})) or one of the New Tab addresses. An explicit about:blank is a blank page, not this. */
function asksForNewTab(address) {
 if (address === undefined || address === null) return true;
 const text = String(address).trim();
 return text === '' || /^(?:chrome:\/\/(?:newtab|new-tab-page)\/?|about:newtab|chrome-search:\/\/local-ntp\/local-ntp\.html)$/i.test(text);
}

module.exports = {NEW_TAB, isOverridePage, overrideFor, normalizeTabs, pageUrlOf, pageTitle, quietPatch, asksForNewTab};
