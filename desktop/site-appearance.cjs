'use strict';
// Website appearance (13.3): System · Light · Dark · Always dark. One setting for the colours websites are shown in, apart from Acira's own appearance.
//  - System: nothing is done; sites follow Acira's appearance through the window's colour scheme (today's behaviour, and no debugger is touched).
//  - Light / Dark: each website tab is told prefers-color-scheme light or dark (CDP Emulation.setEmulatedMedia). A site with a dark theme of its own switches; a site without one stays as it is.
//    A tab that is told what it would follow anyway (Dark while Acira is dark, Light while Acira is light) is not touched at all.
//  - Always dark: Dark, plus Chromium's own Auto Dark Mode (CDP Emulation.setAutoDarkModeOverride, the DevTools "Emulate auto dark mode" switch) for the sites that have no dark theme.
//    Colours are changed when Chromium paints: the page's DOM, styles and scripts are never touched, images / canvas / video are left as they are (Chromium classifies them), and a site
//    that already has a dark theme is not darkened a second time (the tab is told dark, so Auto Dark Mode leaves `color-scheme: light dark` and `only light` alone).
//  - Both overrides belong to the debugger session: they end when it detaches. The session is a lease on the page's one debugger (page-debugger.cjs), shared with tab sleep, the
//    camera check, the zoom glide and secured pages, so none of them gives up because a tab is dark. Leaving a mode clears the overrides first, because the session may stay.
//  - A cross-origin frame lives in its own process and is not reached by the page's session: Target.setAutoAttach hands us each frame's session, which gets the same commands.
//    Only frames are followed (AUTO's filter). A page's workers are never attached and never detached: asking Chromium to attach us to every Web Worker and then sending Target.detachFromTarget
//    for each one killed the whole browser process (SIGSEGV in Electron's native layer, a few seconds after opening sites that start workers). The same holds for every session this module
//    opens: Always dark, and Light / Dark whenever they differ from Acira's own appearance, the page's session and the nested session of every frame.
//  - The Auto Dark Mode override lives in the page's blink settings, and Chromium re-applies those whenever it pushes the page's web preferences again: webContents.setVisualZoomLevelLimits
//    (the zoom paths, page creation) and a change of Acira's own appearance (nativeTheme 'updated': the app's, or the system's at sunset) both do, and the page turns light while the session
//    stays attached. The zoom paths therefore never call it on a page that holds a session (page-zoom-glide.cjs clearMagnification / ensureLimits), and refreshAll({force}) and reassert()
//    send the override again in the same turn as the cause (one command per page and per frame, only in Always dark). The colour scheme emulation is a media override and is not affected.
//  - Nothing here may take the app down: every entry point (attach, refreshAll, the debugger's messages, the timers) swallows its own failure, a page that cannot be told stays as it is, and a page
//    whose renderer crashed is left alone until it navigates again.
// Only in Always dark: a site is left out by its registrable domain (script-rules.cjs siteOfUrl), saved as a row `dark:<site>` = {dark:'exclude'} in the profile's policies table, and the
// page menu offers "Exclude this site from dark mode" / "Include this site again". A left-out site is shown as System shows it. A private tab keeps its choices in memory. A Tor tab is never touched.
const {siteOfUrl} = require('./browser-services/script-rules.cjs');
const pageDebugger = require('./page-debugger.cjs');
const KEY = 'dark:', LIMIT = 500;
const MODES = ['system', 'light', 'dark', 'always-dark'];
const AUTO = {autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{type: 'iframe'}, {exclude: true}]}; // only cross-process frames: no worker is ever attached (see above)

const withTimeout = (promise, ms) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The page did not answer.')), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer)); };

/**
 * mode(): the setting. nativeDark(): whether pages follow a dark Acira on their own (the window's colour scheme). isTor(entry), profileOf(entry): as in script-rules.cjs.
 * acquire: the page-debugger lease (a stand-in in tests). retryMs: how long to wait when another debugger holds the page.
 */
function createSiteAppearance({database, mode, nativeDark = () => false, isTor = () => false, profileOf, acquire = pageDebugger.acquire, commandMs = 4000, retryMs = 1500, retries = 5}) {
  const pages = new Map(); // webContents -> {tabId, profileId, privacy, lease, want, frames:Set, listener, busy, again, tries, timer}
  const memory = new Map(); // private profile id -> Map(site -> excluded)
  const isPrivate = profileId => String(profileId || '').startsWith('private-');
  const modeNow = () => { const value = mode(); return MODES.includes(value) ? value : 'system'; };
  const excludedOn = (profileId, site) => {
    if (isPrivate(profileId)) return memory.get(profileId)?.get(site) === true;
    try { return database.policy(profileId, KEY + site)?.dark === 'exclude'; } catch { return false; }
  };
  const eligible = (wc, url) => {
    const entry = pages.get(wc);
    if (!entry || wc.isDestroyed() || isTor(entry)) return {supported: false, site: ''};
    const site = siteOfUrl(url);
    return {supported: Boolean(site), site};
  };
  /** The state of one page for the menu: supported (a website, not Tor), whether Always dark is chosen (the only mode with the row), whether this site is left out. */
  function status(wc) {
    const entry = pages.get(wc), {supported, site} = eligible(wc, wc.getURL());
    if (!entry || !supported) return {supported: false, enabled: false, site: '', excluded: false};
    return {supported: true, enabled: modeNow() === 'always-dark', site, excluded: excludedOn(profileOf(entry), site)};
  }
  /** What one page should be told: {scheme: 'light'|'dark', auto} or null for nothing. */
  const wanted = (wc, url) => {
    const entry = pages.get(wc), {supported, site} = eligible(wc, url), current = modeNow();
    if (!entry || !supported || current === 'system') return null;
    if (current === 'light') return {scheme: 'light', auto: false};
    if (current === 'dark') return {scheme: 'dark', auto: false};
    return excludedOn(profileOf(entry), site) ? null : {scheme: 'dark', auto: true};
  };
  /** What the page needs a session for: Auto Dark Mode always, a colour scheme only when it differs from what the page follows anyway. */
  const needsSession = want => Boolean(want) && (want.auto || want.scheme !== (nativeDark() ? 'dark' : 'light'));
  /** For the Sec-CH-Prefers-Color-Scheme header: true or false when this tab is told a scheme, undefined when it follows Acira. */
  function darkFor(wc, url) {
    if (!wc || !pages.has(wc)) return undefined;
    try { const want = wanted(wc, url || wc.getURL()); return want ? want.scheme === 'dark' : undefined; } catch { return undefined; }
  }
  const send = (lease, method, params, sessionId) => { try { return withTimeout(lease.sendCommand(method, params, sessionId), commandMs); } catch (error) { return Promise.reject(error); } }; // every command ends: answered, refused, or after commandMs; a throw is a refusal
  /** The commands that make one page (or one frame's process) light, dark or auto-dark. */
  async function tell(lease, want, sessionId) {
    await send(lease, 'Emulation.setAutoDarkModeOverride', {enabled: want.auto}, sessionId);
    await send(lease, 'Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: want.scheme}]}, sessionId);
  }
  /** Takes back both overrides (the session may stay for another feature, so letting go is not enough). */
  async function clear(lease, sessionId) {
    await send(lease, 'Emulation.setAutoDarkModeOverride', {}, sessionId);
    await send(lease, 'Emulation.setEmulatedMedia', {features: []}, sessionId);
  }
  async function enable(wc, entry, want) {
    const lease = acquire(wc, 'appearance');
    if (!lease) { retryLater(wc, entry); return; } // another debugger (Tor, a hidden cookie page) holds the page
    entry.lease = lease; entry.want = want; entry.frames = new Set(); entry.tries = 0;
    lease.onDetach(() => { if (entry.lease === lease) { entry.lease = null; entry.want = null; entry.frames = new Set(); retryLater(wc, entry, Math.min(300, retryMs)); } });
    entry.listener = (_event, method, params) => {
      try {
        if (method === 'Target.detachedFromTarget' && params?.sessionId) { entry.frames.delete(params.sessionId); return; }
        if (method !== 'Target.attachedToTarget' || !params?.sessionId || entry.lease !== lease) return;
        if (params.targetInfo?.type !== 'iframe') return; // anything else (a worker the filter should have kept out): not ours, no command, above all no detach
        entry.frames.add(params.sessionId);
        tell(lease, entry.want, params.sessionId).catch(() => {});
        send(lease, 'Target.setAutoAttach', AUTO, params.sessionId).catch(() => {}); // frames inside that frame
      } catch { /* a message handler must never throw into Electron */ }
    };
    lease.on('message', entry.listener);
    try {
      await send(lease, 'Target.setAutoAttach', AUTO);
      await tell(lease, want);
    } catch (error) { await disable(wc, entry); throw error; }
  }
  /** A page that is already ours changes what it is told, in place (no gap in between). */
  async function change(entry, want) {
    const lease = entry.lease;
    await tell(lease, want);
    entry.want = want; // only once the page has it: a call that failed halfway is made again
    for (const sessionId of entry.frames) tell(lease, want, sessionId).catch(() => {});
  }
  /** Chromium reset the page's Auto Dark Mode override (it pushed the web preferences again) and nothing else: one command for the page and one for each frame. The colour scheme emulation is
   *  a media override that survives (measured), and a tab that is not in Always dark has no Auto Dark Mode to lose. */
  async function reapply(entry) {
    const lease = entry.lease;
    await send(lease, 'Emulation.setAutoDarkModeOverride', {enabled: true});
    for (const sessionId of entry.frames) send(lease, 'Emulation.setAutoDarkModeOverride', {enabled: true}, sessionId).catch(() => {});
  }
  /** System, or a tab that follows Acira anyway: the overrides are taken back and the session let go. */
  async function disable(wc, entry) {
    const lease = entry.lease;
    entry.lease = null; entry.want = null;
    if (!lease) return;
    const frames = [...entry.frames]; entry.frames = new Set();
    try { if (entry.listener) lease.removeListener('message', entry.listener); } catch { /* gone */ }
    entry.listener = null;
    if (!lease.over) {
      try {
        for (const sessionId of frames) await clear(lease, sessionId).catch(() => {});
        await clear(lease);
        await send(lease, 'Target.setAutoAttach', {autoAttach: false, waitForDebuggerOnStart: false, flatten: true}).catch(() => {});
      } catch { /* the page did not answer: letting go ends the session's own overrides if it was the only holder */ }
    }
    lease.release();
  }
  /** Another debugger holds the page, or it did not answer: look again shortly, a few times, then wait for the next navigation or setting change. */
  function retryLater(wc, entry, ms = retryMs) {
    if (entry.timer || entry.tries >= retries || wc.isDestroyed()) return;
    entry.tries += 1;
    entry.timer = setTimeout(() => { entry.timer = null; void apply(wc); }, ms);
    entry.timer.unref?.();
  }
  /** Brings one page to what it should be showing. Never rejects: a page that cannot be told stays as it is (callers fire it and forget it, so nothing may escape). */
  async function apply(wc, url, fresh = false, force = false) {
    try { await bring(wc, url, fresh, force); } catch { /* the page is looked at again at its next navigation or setting change */ }
  }
  /** Calls for the same page never overlap: a call that arrives meanwhile runs once more at the end. */
  async function bring(wc, url, fresh, force = false) {
    const entry = pages.get(wc);
    if (!entry || wc.isDestroyed()) return;
    if (fresh) entry.tries = 0;
    if (entry.gone || wc.isCrashed?.()) return; // its renderer crashed: no session on a dead page, no attach loop; the next navigation looks again
    if (entry.busy) { entry.again = url || true; entry.againForce = entry.againForce || force; return; }
    entry.busy = true;
    try {
      const want = wanted(wc, url || wc.getURL()), session = needsSession(want) ? want : null;
      if (session && !entry.lease) await enable(wc, entry, session);
      else if (session && (entry.want.scheme !== session.scheme || entry.want.auto !== session.auto)) await change(entry, session);
      else if (session && force && session.auto) await reapply(entry);
      else if (!session && entry.lease) await disable(wc, entry);
    } catch (error) {
      void error; // a page that did not answer is looked at again below
      retryLater(wc, entry);
    } finally {
      entry.busy = false;
      if (entry.again) { const next = entry.again === true ? undefined : entry.again, again = entry.againForce; entry.again = false; entry.againForce = false; void apply(wc, next, false, again); }
    }
  }
  /** Follows one website page for its life. */
  function attach(wc, tab) {
    try {
      if (pages.has(wc)) return;
      const entry = {tabId: tab.id, profileId: tab.browserProfileId, privacy: tab.privacy, lease: null, want: null, frames: new Set(), listener: null, busy: false, again: false, tries: 0, timer: null, gone: false};
      pages.set(wc, entry);
      try { wc.setMaxListeners(Math.max(wc.getMaxListeners?.() || 10, 20)); } catch { /* a stand-in */ } // a link preview's page has Node's default of 10 and this adds four
      // At the commit, not at the start: the old page keeps its look until the new one is there. A tab that stays as it is keeps its session, so only a change costs anything.
      wc.on('did-navigate', (_event, url) => { entry.gone = false; void apply(wc, url, true); });
      wc.on('dom-ready', () => { entry.gone = false; void apply(wc, undefined, true); });
      wc.on('render-process-gone', (_event, details) => { if (details?.reason !== 'clean-exit') entry.gone = true; });
      wc.once('destroyed', () => { clearTimeout(entry.timer); try { entry.lease?.release(); } catch { /* gone */ } entry.lease = null; pages.delete(wc); });
      void apply(wc);
    } catch { /* a page's creation never fails because of its colours: it is simply not followed */ pages.delete(wc); }
  }
  function setExcluded(wc, excluded) {
    const entry = pages.get(wc), {supported, site} = eligible(wc, wc.getURL());
    if (!entry || !supported) throw new Error('Open a website first.');
    const profileId = profileOf(entry);
    if (isPrivate(profileId)) { if (!memory.has(profileId)) memory.set(profileId, new Map()); memory.get(profileId).set(site, Boolean(excluded)); }
    else if (excluded) {
      let count = 0; try { count = database.policies(profileId).filter(row => row.site.startsWith(KEY)).length; } catch { /* the table is read again below */ }
      if (count >= LIMIT && excludedOn(profileId, site) !== true) throw new Error('The list is full.');
      database.setPolicy(profileId, KEY + site, {dark: 'exclude'});
    } else database.deletePolicy(profileId, KEY + site);
    for (const other of pages.keys()) { if (siteOfUrl(other.getURL()) === site) void apply(other, undefined, true); }
    return status(wc);
  }
  /** The setting changed, or Acira's own appearance did (what a tab follows anyway). `force`: Acira's appearance changed, and Chromium pushes the page's web preferences again
   *  when it does, which drops the Auto Dark Mode override while the debugger session stays attached: every page that holds a session is told again, in the same turn. */
  function refreshAll({force = false} = {}) { for (const wc of [...pages.keys()]) void apply(wc, undefined, true, force); }
  /** A page that holds a session is told its appearance again, at once (something just pushed its web preferences: webContents.setVisualZoomLevelLimits does). Nothing if it holds none. */
  function reassert(wc) { if (pages.has(wc)) void apply(wc, undefined, false, true); }
  /** For tests and the menu: the settled state of one page. */
  const stateOf = wc => { const entry = pages.get(wc); return entry ? {session: Boolean(entry.lease), want: entry.want, frames: entry.frames.size} : null; };
  return {attach, status, setExcluded, refreshAll, reassert, wanted, darkFor, stateOf, whenIdle: async wc => { for (let i = 0; i < 200 && pages.get(wc)?.busy; i += 1) await new Promise(resolve => setTimeout(resolve, 5)); }};
}
module.exports = {createSiteAppearance, KEY, MODES, LIMIT};
