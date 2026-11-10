'use strict';
// Test and QA hooks (environment variables and debugging switches) are for development checkouts, the QA twin ("Acira Browser QA",
// never published) and runs on an isolated test profile (ACIRA_BROWSER_TEST_DATA, a folder that is not the person's own profile).
// A real, packaged Acira started on the person's own profile drops the ones that weaken it, first thing in main.cjs, so nothing in the
// environment or on a command line can load the interface from another server, point updates at another feed, pretend to be an older
// version, run with no window on screen, or open a debugging port into the person's browser. Chrome does the same since 136: its
// remote debugging switches only work on a profile folder that is not the default one.
// Kept everywhere because they only move what is timed or logged: ACIRA_STARTUP_TRACE / _PROFILE / _REQUIRES (timing files where asked) and the
// console-only debug logs (ACIRA_PERF, ACIRA_EDGE_TRACE, ACIRA_QA_VIEW_LOG ...): KEPT_ENV below. ACIRA_BROWSER_TEST_DATA and _DOWNLOAD_DIR stay only
// on a test profile (TEST_PROFILE_ENV), which on a packaged Mac build also gets the mock keychain. The table of every hook is in docs/launch/TEST_HOOKS.md.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const HOOK_ENV = Object.freeze([
  'ACIRA_DEV', // the interface from the dev server at http://127.0.0.1:5194, which the browser bridge then trusts
  'ACIRA_PREVIEW_RECORD', // preview build records and process metadata written into the profile
  'ACIRA_UPDATE_TEST', 'ACIRA_UPDATE_FEED', 'ACIRA_UPDATE_FEED_FALLBACK', 'ACIRA_UPDATE_STUB', 'ACIRA_UPDATE_STUB_VERSION', 'ACIRA_UPDATE_STUB_NOTES', // another update feed, a stand-in updater
  'ACIRA_UPDATE_TEST_VERSION', 'ACIRA_UPDATE_TEST_ARCH', 'ACIRA_UPDATE_TEST_PLATFORM', // a pretend version (an older one would be offered a downgrade), arch or platform
  'ACIRA_UPDATE_TEST_FRESH_MS', // how long a feed answer counts as fresh (test mode only), so a rig can rehearse the Windows quit check at once
  'ACIRA_UPDATE_TEST_PRIMARY_WITHIN_MS', 'ACIRA_UPDATE_TEST_FALLBACK_WITHIN_MS', // how long each feed address is given before the next is asked (test mode only), so a rig need not wait 15 s for a silent one
  'ACIRA_SPELLCHECK_DICTIONARY_URL', // spelling dictionaries from another server
  'ACIRA_SAFE_BROWSING_KEY', // a Safe Browsing key that replaces the one saved in Settings
  'ACIRA_KEEP_ELECTRON_UA', // Electron's own user agent, which names Acira's engine to every site
  'ACIRA_BROWSER_TEST_HIDDEN', 'ACIRA_TEST_APP_DIALOG', 'ACIRA_TEST_SHARE_PICKER', // no window on screen; dialogs answered without the person
  'ACIRA_QA_RUN', 'ACIRA_QA_LIVE_GOOGLE', // QA host rules
  'ACIRA_SITE_COLOR_PROBE', 'ACIRA_SITE_COLOR_PROBE_LOG', // the site-colour research probe (desktop/site-color-probe.cjs): reads page pixels and colours for a research log; a test profile only
  'ACIRA_SIMULATE_SYSTEM_THEME', // a pretend Linux desktop theme ({"dark":true,"accent":"#9141ac"}) for pictures and tests of Match my system theme
  // These already need a test profile where they are read; dropped too, so a later change that forgets that check stays safe.
  'ACIRA_TEST_QUIET_NETWORK', 'ACIRA_TEST_TOR_SIMULATE_BLOCK', 'ACIRA_TEST_PASSKEY_STUB', 'ACIRA_TEST_DATABASE_CHOICE', 'ACIRA_TEST_SERVICES_DELAY_MS',
  'ACIRA_TEST_LIVE_PRS', 'ACIRA_TEST_LIVE_PRS_TRACE', 'ACIRA_TEST_PRIVATE_PREPARE', 'ACIRA_PASSWORDS_TEST_GATE', 'ACIRA_PASSWORDS_TEST_FILES', 'ACIRA_METRICS_ENDPOINT', 'ACIRA_SITE_REPORT_ENDPOINT',
  'ACIRA_SITE_ALLOWLIST_ENDPOINT', 'ACIRA_SITE_ALLOWLIST_FILE', 'ACIRA_EXT_NOTIFICATIONS_NATIVE', 'ACIRA_WINDOWS_BUILD',
  'ACIRA_BOOKMARK_TRACE', // logs each extension bookmark-store change (extension-bookmark-buffer.cjs), for rigs only
  'ACIRA_POPUP_HOST', // 'window' | 'parent': an extension's toolbar popup as a window of its own or as a view inside the browser window (extension-popup-host.cjs), for rigs on a Mac; read only on a test profile
]);
// The other ACIRA_ names the shipped code reads, and why a real build keeps them (tests/test-hooks-packaged.test.cjs makes every new one
// pick a list).
const KEPT_ENV = Object.freeze({
  ACIRA_BROWSER_TEST_DATA: 'moves the profile to a test folder; dropped (TEST_PROFILE_ENV) when the folder is the person\'s own profile, inside it or a link to it',
  ACIRA_BROWSER_TEST_DOWNLOAD_DIR: 'moves downloads into a folder inside the test profile; dropped with ACIRA_BROWSER_TEST_DATA',
  ACIRA_STARTUP_TRACE: 'writes start-up timing marks to the file the launcher names',
  ACIRA_STARTUP_PROFILE: 'writes an in-process start-up CPU profile to the file the launcher names (no debugging port)',
  ACIRA_STARTUP_REQUIRES: 'writes module load times to the file the launcher names',
  ACIRA_PERF: 'keeps background throttling on for timing runs on a test profile',
  ACIRA_DISSOLVE: 'chooses the page dissolve style (looks only)',
  ACIRA_MATERIAL: 'turns the window material off (looks only)',
  ACIRA_NO_SPLASH: 'skips the start-up splash (looks only)',
  ACIRA_QA_NO_NTP_STILL: 'skips the new tab still picture (looks only)',
  ACIRA_MEMORY_SAVER_IDLE_MS: 'tab sleep timing',
  ACIRA_MEMORY_SAVER_FREEZE_MS: 'tab sleep timing',
  ACIRA_MEMORY_SAVER_TICK_MS: 'tab sleep timing',
  ACIRA_RATING_QUIET_MS: 'rating prompt timing, read only on a test profile',
  ACIRA_MEMORY_SAVER_DEBUG: 'console log only',
  ACIRA_PM_LOG: 'console log only',
  ACIRA_EDGE_TRACE: 'console log only',
  ACIRA_CAPTURE_DEBUG: 'console log only',
  ACIRA_STORE_BAR_DEBUG: 'console log only',
  ACIRA_QA_VIEW_LOG: 'console log only',
  ACIRA_QA_DISSOLVE_TRACE: 'console log only',
});
// Chromium's DevTools server switches. Removed before 'ready', so the server never starts. (Node's --inspect is an Electron fuse,
// packaging/fuses.cjs.)
const DEBUG_SWITCHES = Object.freeze(['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'remote-debugging-io-pipes', 'remote-allow-origins']);
const caseless = platform => platform === 'win32' || platform === 'darwin';
const sameName = (a, b, platform) => caseless(platform) ? a.toLowerCase() === b.toLowerCase() : a === b;
// "." and ".." in a test profile path are refused: path.resolve folds them away as text, while the system follows a link first (link/.. is the link
// target's parent), so the folder judged and the folder used could differ.
const dotted = folder => folder.split(/[\\/]+/).some(part => part === '.' || part === '..');
// A folder's identity: device and inode (volume and file ID on Windows). It sees through what path text does not: links, APFS firmlinks
// (/System/Volumes/Data/Users/...) and Windows \\localhost\C$ paths.
function folderId(folder) { try { const stat = fs.statSync(folder, { bigint: true }); return stat.isDirectory() ? stat.dev + ':' + stat.ino : null; } catch { return null; } }
// The folder as the system will use it: the deepest folder that exists resolved (links, /tmp to /private/tmp, Windows short names and \\?\
// prefixes) and the rest of the path put back.
function physical(folder) {
  const rest = [];let resolved = path.resolve(folder);
  for (let current = resolved; ;) {
    try { resolved = path.join(fs.realpathSync.native(current), ...rest); break; } catch { /* not there yet: try its parent */ }
    const parent = path.dirname(current); if (parent === current) break;
    rest.unshift(path.basename(current)); current = parent;
  }
  return resolved;
}
const comparable = (folder, platform) => { const resolved = physical(folder); return caseless(platform) ? resolved.toLowerCase() : resolved; };
/** True when `folder` is `profile` or a folder inside it: by resolved path, and by the identity of `folder` and of each folder above it (the profile
 *  itself, or the folder that holds it followed by the profile's name, for a profile that does not exist yet). */
function sameOrInside(folder, profile, platform = process.platform) {
  const a = comparable(folder, platform), b = comparable(profile, platform);
  if (a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)) return true;
  const own = folderId(profile), holder = folderId(path.dirname(profile)), name = path.basename(profile), below = [];
  for (let current = path.resolve(folder); ;) {
    const id = folderId(current);
    if (id && (id === own || id === holder && below.length > 0 && sameName(below[0], name, platform))) return true;
    const parent = path.dirname(current); if (parent === current) return false;
    below.unshift(path.basename(current)); current = parent;
  }
}
/** An isolated test profile: ACIRA_BROWSER_TEST_DATA set to an absolute folder, with no "." or "..", that is not the person's own profile (or inside it). */
function isolatedTestProfile(env, realProfile, platform = process.platform) {
  const folder = env.ACIRA_BROWSER_TEST_DATA;
  return typeof folder === 'string' && path.isAbsolute(folder) && !dotted(folder) && [].concat(realProfile).every(profile => !sameOrInside(folder, profile, platform));
}
/** Where the person's own profile is. On a Mac, appData follows CFFIXED_USER_HOME, which anything that starts Acira can set; the account's home
 *  from the user database cannot be moved that way, so the profile there counts as the person's own as well. */
function ownProfiles({ app, identity, platform, homedir }) {
  const list = [path.join(app.getPath('appData'), identity.dataFolder)];
  if (platform === 'darwin') { try { const home = homedir === undefined ? os.userInfo().homedir : homedir; if (home) list.push(path.join(home, 'Library', 'Application Support', identity.dataFolder)); } catch { /* no account record: appData alone */ } }
  return list;
}
const hooksAllowed = ({ isPackaged, qa, env, realProfile, platform = process.platform }) => !isPackaged || Boolean(qa) || isolatedTestProfile(env, realProfile, platform);
// Only meaningful on a test profile: without one they would move the person's own profile (a link, a folder inside it) or mark it as a test run
// (updates off), so a real build drops them too.
const TEST_PROFILE_ENV = Object.freeze(['ACIRA_BROWSER_TEST_DATA', 'ACIRA_BROWSER_TEST_DOWNLOAD_DIR']);
// Chromium's stand-in for the macOS Keychain: Safe Storage (cookies, saved passwords, the vault) gets a fixed key instead of the app's Keychain item.
const MOCK_KEYCHAIN = 'use-mock-keychain';
/** A test profile a packaged build accepts is used exactly as judged: judged by the path the system will use, made, judged again by its real path,
 *  and that real path is what Acira then uses (main.cjs sets userData from ACIRA_BROWSER_TEST_DATA; downloads follow). 'own' when it turns out to be
 *  the person's own profile (Acira then drops the hooks and stays on it), 'failed' when it cannot be made or resolved. */
let judged = null;
function settleTestProfile(env, realProfile, platform) {
  let real;
  try {
    const folder = physical(env.ACIRA_BROWSER_TEST_DATA);
    if (!isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: folder }, realProfile, platform)) return 'own';
    fs.mkdirSync(folder, { recursive: true }); real = fs.realpathSync.native(folder);
  } catch { return 'failed'; }
  if (!isolatedTestProfile({ ACIRA_BROWSER_TEST_DATA: real }, realProfile, platform)) return 'own';
  const id = folderId(real); if (!id) return 'failed';
  env.ACIRA_BROWSER_TEST_DATA = real; judged = { folder: real, id };
  const downloads = env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
  if (typeof downloads === 'string') { if (path.isAbsolute(downloads) && !dotted(downloads)) env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR = physical(downloads); else delete env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR; }
  return 'ok';
}
/** Called in main.cjs once userData is set, just before Acira takes its profile lock: the folder it is about to use must still be the one lockDown
 *  judged (same path, same identity), not one swapped for a link to the person's profile meanwhile. Stops Acira otherwise. */
function checkJudged(app, exit = code => process.exit(code)) {
  if (!judged) return true;
  const folder = app.getPath('userData');let now = null;
  try { now = fs.realpathSync.native(folder); } catch { /* gone: not the folder judged */ }
  if (now === judged.folder && folderId(folder) === judged.id) return true;
  console.error('Acira stopped: its test profile folder changed after it was checked.'); exit(1); return false;
}
/** Runs first thing in main.cjs, before anything reads a hook or uses the Keychain. Returns what it removed (env, switches; empty when the hooks stay
 *  available) and the switches it added. */
function lockDown({ app, identity, env = process.env, platform = process.platform, homedir, exit = code => process.exit(code) }) {
  const removed = { env: [], switches: [], added: [] };
  const realProfile = ownProfiles({ app, identity, platform, homedir });
  const testProfileOnly = app.isPackaged && !identity.qa;
  const allowed = hooksAllowed({ isPackaged: app.isPackaged, qa: identity.qa, env, realProfile, platform });
  const settled = allowed && testProfileOnly ? settleTestProfile(env, realProfile, platform) : 'ok';
  // A test profile that cannot be made (a read-only volume, a missing disk) must not turn into a run on the person's own profile: stop instead.
  if (settled === 'failed') { console.error('Acira stopped: its test profile folder could not be made or checked:', env.ACIRA_BROWSER_TEST_DATA); removed.stopped = true; exit(1); return removed; }
  if (allowed && settled === 'ok') {
    // A packaged Mac build allows the hooks here only because of a test profile. Its Safe Storage key is the app's Keychain item, not the profile's,
    // so a copy of the person's profile run as a "test profile" with a debugging port would show their cookies and vault decrypted, with no Keychain
    // prompt. A test profile gets the mock keychain instead (every release rig already asks for it), so such a copy stays unreadable. os_crypt
    // reads the switch when it first makes its key, after this (tests/test-hooks-keychain.test.cjs runs it in Electron).
    if (testProfileOnly && platform === 'darwin' && !app.commandLine.hasSwitch(MOCK_KEYCHAIN)) { app.commandLine.appendSwitch(MOCK_KEYCHAIN); removed.added.push(MOCK_KEYCHAIN); }
    return removed;
  }
  for (const name of [...HOOK_ENV, ...TEST_PROFILE_ENV]) if (name in env) { delete env[name]; removed.env.push(name); }
  // On the person's own profile the mock keychain would make their saved sign-ins, passwords and vault unreadable (and write new ones with its key).
  for (const name of [...DEBUG_SWITCHES, MOCK_KEYCHAIN]) if (app.commandLine.hasSwitch(name)) { app.commandLine.removeSwitch(name); removed.switches.push(name); }
  if (removed.env.length || removed.switches.length) console.warn('Acira ignored test hooks on this profile:', [...removed.env, ...removed.switches.map(name => '--' + name)].join(', '));
  return removed;
}
module.exports = { HOOK_ENV, KEPT_ENV, TEST_PROFILE_ENV, DEBUG_SWITCHES, MOCK_KEYCHAIN, sameOrInside, isolatedTestProfile, hooksAllowed, lockDown, checkJudged };
