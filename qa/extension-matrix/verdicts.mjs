// The call made for each extension after reading the probe results (docs/launch/EXTENSION_COMPATIBILITY.md has the evidence).
// works: install, popup, page scripts and restart all pass and nothing the extension is for is known to be broken.
// limited: it loads and part of it works; the note says which part does not.
// unsupported: the thing the extension is for does not work in Acira's engine.
// Notes are shown to people in Settings → Extensions and on the Add to Acira bar: plain words, no developer terms, honest about what was not exercised.
// 27 Oct (round 4): re-run on the build with offscreen, side panel, identity, user scripts, New Tab choice, idle, bookmarks/history/sessions/search.
// 27 Oct (password managers): 1Password and Proton Pass re-run after `browser` gained the engine's namespaces (qa/extension-matrix/pm-trace.mjs).
// 27 Oct (recheck): every limited/unsupported entry except uBlock Origin Lite and React DevTools re-run with qa/extension-matrix/recheck.mjs
// (worker-startup trace, popup/side-panel screenshots, settings, page scripts, restart) after the engine fixes listed in the doc.
// 27 Oct (declarativeNetRequest): rules are enforced now (qa/dnr-live.mjs) — Privacy Badger, Tampermonkey's .user.js install, uBlock Origin Lite.
// An extension without an entry here (MetaMask: our probe could not read its popup; Wappalyzer: not installable yet) shows no tested label.
export const VERDICTS = {
  bitwarden: ['works', 'Popup, form scripts, restart and tab sleep work, and its side panel and idle lock now have what they need. Unlocking with the desktop app or biometrics, and signing in to a vault, were not tested.'],
  '1password': ['works', 'Its toolbar button opens 1Password’s setup and Sign in screen, page scripts load, and it keeps running after a restart and when idle. Signing in, filling and unlocking with the desktop app were not tested.'],
  'proton-pass': ['works', 'The popup shows its Sign in screen, its icon appears in sign-in fields, and it keeps running after a restart and when idle. Signing in and filling were not tested.'],
  'ublock-lite': ['works', 'Blocks ads and trackers with its default filter lists, also on sites where Acira’s protection is off. Hiding page elements and its per-site filtering modes were not tested.'],
  'dark-reader': ['works', 'Dark mode, settings, restart and tab sleep work. Its font setting is unavailable.'],
  grammarly: ['limited', 'The popup shows its Sign up screen and the Grammarly button appears on text boxes. Checking needs a Grammarly account and was not tested. Desktop-app integration does not work.'],
  'google-translate': ['works', 'Popup, settings and the page script work. Translating a page was not exercised.'],
  zotero: ['works', 'Page script, settings, restart and tab sleep work. Saving needs the Zotero desktop app running and was not exercised.'],
  ryd: ['works', 'Shows dislike counts on YouTube, and keeps working after a restart.'],
  sponsorblock: ['works', 'Loads on YouTube; popup and settings work. Skipping a sponsored segment was not exercised.'],
  rakuten: ['works', 'Its button opens Rakuten’s sign-in page, its settings page and page scripts on rakuten.com work, and it keeps running after a restart. Cash back needs a Rakuten account and was not tested.'],
  'react-devtools': ['unsupported', 'It detects React on a page, but its Components and Profiler panels never appear in Acira’s developer tools.'],
  vimium: ['works', 'Keys, link hints, popup and settings work, and its search bar can read your bookmarks and history.'],
  tampermonkey: ['limited', 'Turn on Allow user scripts for it in Settings › Extensions. Opening a .user.js address opens its install page, and its popup and settings work, but its popup says it has no access to ordinary pages.'],
  momentum: ['works', 'Choose Use as New Tab page for it in Settings › Extensions and it shows on new tabs. Private and Tor windows keep Acira’s page.'],
  lastpass: ['works', 'The popup shows its Log in screen, settings and page scripts work, and it keeps running after a restart. Signing in and filling were not tested.'],
  honey: ['works', 'The popup opens and page scripts load. Finding coupons on shopping sites was not exercised.'],
  acrobat: ['works', 'Its button opens Acrobat’s PDF tools in the side panel, and settings and page scripts work. Linking to the Acrobat desktop app is not available. Signing in and opening PDFs were not tested.'],
  'docs-offline': ['limited', 'Installs and runs in the background. Offline Google Docs needs a signed-in Google account and was not tested.'],
  loom: ['unsupported', 'Its button hands over to Loom’s background part, which needs a Loom account and screen-recording features (tab and desktop capture) that Acira’s engine does not have.'],
  'notion-clipper': ['works', 'The popup shows Notion’s Log in screen and it keeps running after a restart. Clipping needs a Notion account; signing in and clipping were not tested.'],
  todoist: ['works', 'The popup shows Todoist’s Log in screen, settings work, and it keeps running after a restart. Signing in and adding tasks were not tested.'],
  colorzilla: ['works', 'The eyedropper picks colours from pages, and the popup and settings work. Picking colours outside the browser was not tested.'],
  'video-speed': ['works', 'Speed controls appear on videos; popup and settings work.'],
  violentmonkey: ['limited', 'Popup and settings work. Turn on Allow user scripts for it in Settings › Extensions. Opening a .user.js address does not reach its install page, and running a script was not tested.'],
  'privacy-badger': ['works', 'Blocks the trackers it knows and sends Do Not Track and Global Privacy Control, also on sites where Acira’s protection is off. Popup and page scripts work. Learning new trackers as you browse was not tested.']
};
