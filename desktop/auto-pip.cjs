'use strict';
// Beta 14: automatic picture in picture ("Pop the video out when I leave its tab"; Settings > Tabs; off by default). Built on section N's
// plumbing (the same page request the card's button and Alt+P make). The now-playing card itself never pops a video out on its own.
//
// When the person LEAVES a tab (switches to another tab, another workspace, or opens a new tab; not when they only switch to another app or
// minimise: tab switch only) and every one of these is true, its video is popped out:
//   the setting is on; the tab's video has been playing with sound (not muted, volume above zero) for a few seconds while the person was on
//   the tab; it is a real video (big enough in the page, longer than a few seconds, not a loop, not a camera or call stream, allowed by the
//   site: disablePictureInPicture is respected; a video the person already popped out by hand is left exactly as it is); no camera, microphone or screen
//   share; not fullscreen; not a Tor tab (the small window is
//   Chromium's own and shows nothing the page does not; it is kept off in Tor windows because the Tor rules are not ours to bend).
// It does not when the video was paused, when the tab was never looked at (section Q: it cannot be playing), or when the person closed the
// small window by hand (not again until they play the video again in its tab; switching the setting off and on also starts afresh).
// The window's own two buttons (Chromium's; Arc's behave the same): X closes it and PAUSES the video (Chromium pauses it itself), Back to tab closes it and leaves the video PLAYING. Acira cannot see
// which button was pressed, only that the window went away (the page's `leavepictureinpicture`, sent by browser-services/pip-signal-preload.cjs with the video's state at that moment; a slow poll is the
// fallback) and what the video is doing a moment later: paused (or ended) = X, so the tab stays as it is and the pop-out is not offered again until the person plays the video again; still playing =
// Back to tab, so the tab that owns the video is brought to the front (and the window with it) at once (`back`) - but ONLY when Acira is the active app (`active`): a real click on the small window's
// button activates the app first, while a page script that ends picture in picture (or Acira's own card / Alt+P exit, which `ownPip` marks) must never pull Acira in front of what the person is doing.
// With the app not active a still-playing exit is a plain return: nothing is selected, nothing is raised, the tab is not suppressed.
// One pop-out at a time: popping a newer video out sends the older one back to its tab (Chromium closes the first window). Coming back to the
// tab returns the video into the page by itself. Switching tabs fast, many times, never leaves an orphan window or doubles a sound: every pop
// out and every return is one step in a per-tab chain, and a pop out that finishes after the person has already come back returns at once.
// Nothing here animates or draws: the small window is Chromium's; the page's request is made with a user gesture, the way a click would, and a
// site that refuses (a protected player) simply stays as it is, with no error.

/** How long the person must have been on the tab with the video playing before leaving it counts. */
const WATCH_MS = 3000;
/** A video shorter than this is a clip, a loop or a preview, not "a real video". */
const MIN_SECONDS = 10;
/** How often a popped-out window is checked for being gone: a fallback only (the page's leave event is the signal; a platform without it, a lost message). */
const WATCH_POLL_MS = 1500;
/** The window went away with the video still playing: one more look after this long catches a pause that lands just after the event (X pauses through a message of its own). */
const LEAVE_LOOK_MS = 120;
/** How long Acira's own exit / displacement stays marked after its request finished (the page's event can come after the answer). */
const OWN_MS = 700;
/** Sites that are calls or screen shares: never popped out, whatever the page's video says. */
const CALL_HOSTS = /(^|\.)(meet\.google\.com|zoom\.us|zoom\.com|teams\.microsoft\.com|teams\.live\.com|whereby\.com|webex\.com|meet\.jit\.si|8x8\.vc|discord\.com|skype\.com|gotomeeting\.com|bluejeans\.com|around\.co|slack\.com|chime\.aws|facetime\.apple\.com)$/i;
const isCallSite = url => { try { return CALL_HOSTS.test(new URL(url).hostname); } catch { return false; } };

const KEY = "Symbol.for('acira.autoPip')";
/** In one frame: the video that qualifies (the biggest), remembered on the page for ENTER, else null. Answers { area, live } or null. */
const QUALIFY_SCRIPT = `(()=>{try{if(!document.pictureInPictureEnabled||document.fullscreenElement||document.pictureInPictureElement)return null;let best=null,top=0;for(const v of document.querySelectorAll('video')){if(v.paused||v.ended||v.muted||!(v.volume>0)||v.readyState<2||v.loop||!(v.videoWidth>0))continue;if(v.disablePictureInPicture||v.hasAttribute('disablepictureinpicture')||(typeof MediaStream==='function'&&v.srcObject instanceof MediaStream))continue;const d=v.duration;if(!(d===Infinity||d>=${MIN_SECONDS}))continue;const r=v.getBoundingClientRect(),w=Math.min(r.right,innerWidth)-Math.max(r.left,0),h=Math.min(r.bottom,innerHeight)-Math.max(r.top,0);if(w<320||h<180)continue;const a=w*h;if(a<innerWidth*innerHeight*.2)continue;if(a>top){best=v;top=a;}}if(!best){delete window[${KEY}];return null;}window[${KEY}]=best;return {area:top,live:best.duration===Infinity};}catch(e){return null;}})()`;
/** A read-out for tests and diagnosis only (never used to decide anything): for every video of one frame, the first of the "real video" rules that says no (null = it qualifies), with the values the rules read. */
const EXPLAIN_SCRIPT = `(()=>{try{const out=[];for(const v of document.querySelectorAll('video')){const r=v.getBoundingClientRect(),w=Math.min(r.right,innerWidth)-Math.max(r.left,0),h=Math.min(r.bottom,innerHeight)-Math.max(r.top,0),d=v.duration;let why=null;if(!document.pictureInPictureEnabled)why='pip-not-enabled';else if(document.fullscreenElement)why='fullscreen';else if(document.pictureInPictureElement)why='already-in-pip';else if(v.paused)why='paused';else if(v.ended)why='ended';else if(v.muted)why='muted';else if(!(v.volume>0))why='volume-0';else if(v.readyState<2)why='not-ready';else if(v.loop)why='loop';else if(!(v.videoWidth>0))why='no-picture';else if(v.disablePictureInPicture||v.hasAttribute('disablepictureinpicture'))why='site-forbids';else if(typeof MediaStream==='function'&&v.srcObject instanceof MediaStream)why='media-stream';else if(!(d===Infinity||d>=${MIN_SECONDS}))why='short';else if(w<320||h<180)why='small';else if(w*h<innerWidth*innerHeight*.2)why='small-in-page';out.push({why,paused:v.paused,muted:v.muted,volume:v.volume,ready:v.readyState,loop:v.loop,duration:String(d),seekable:v.seekable&&v.seekable.length?v.seekable.end(v.seekable.length-1):null,w:Math.round(w),h:Math.round(h),vw:v.videoWidth,page:innerWidth+'x'+innerHeight,srcObject:!!v.srcObject,dpip:!!(v.disablePictureInPicture||v.hasAttribute('disablepictureinpicture')),inFrame:window!==window.top})}return out;}catch(e){return [{why:'script-error',error:String(e)}];}})()`;
/** In the frame that qualified: pop the remembered video out (a user gesture is passed by the caller). 'active' | 'none' | 'error'. */
const ENTER_SCRIPT = `(async()=>{const v=window[${KEY}];if(!v||!v.isConnected||v.paused||v.ended||v.disablePictureInPicture)return 'none';if(document.pictureInPictureElement===v)return 'active';try{const n=window[Symbol.for('acira.mediaSession')];if(n&&typeof n.pipDefaults==='function')n.pipDefaults(v);}catch(e){}try{await v.requestPictureInPicture();return 'active';}catch(e){return 'error';}})()`;
/** Bring the video back into the page. */
const EXIT_SCRIPT = `(async()=>{try{if(document.pictureInPictureElement){await document.exitPictureInPicture();return 'inactive';}}catch(e){return 'error';}return 'none';})()`;
/** Is a video of this frame in the small window? */
const STATE_SCRIPT = `(()=>!!document.pictureInPictureElement)()`;
/** What the video that was popped out is doing now: { paused, ended, pip } or null when no video is left. A player that swaps its video element while the window is open (an ad, a quality change: Twitch) leaves the remembered one
 *  out of the page, and the old window stays open on it: the page's biggest connected video then answers, with `swapped: true` and `old` = what the element that is IN the window says (Chromium's X pauses that one; a detached
 *  element can still be read). */
const VIDEO_STATE_SCRIPT = `(()=>{const v0=window[${KEY}];let v=v0&&v0.isConnected?v0:null,swapped=false;if(!v){swapped=true;let top=0;for(const e of document.querySelectorAll('video')){if(!e.isConnected)continue;const r=e.getBoundingClientRect(),a=r.width*r.height;if(a>top){v=e;top=a;}}}if(!v)return null;const out={paused:!!v.paused,ended:!!v.ended,pip:document.pictureInPictureElement===v};if(swapped){out.swapped=true;out.old=v0?{paused:!!v0.paused,ended:!!v0.ended}:null;}return out;})()`;

/** deps: setting(), activeTabId(), tabs() (the window's tabs), frames(tabId) (the page's frames, each with executeJavaScript), tor(tabId), fullscreen(tabId),
 *  together(a, b) (both tabs on screen in one split), now(), setTimer/clearTimer, note(event), beforePop(tabId) (the request is about to be made: the pop-out's saved place is made ready), back(tabId) (Back to tab: bring the tab that owns the video, and the window, to the front), active() (is Acira the active app right now: the click that pressed Back to tab made it so; false where it cannot be told). */
function createAutoPip({ setting, activeTabId, tabs, frames, tor = () => false, fullscreen = () => false, together = () => false, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, note = () => {}, popped: onPopped = () => {}, back = () => {}, active = () => false, beforePop = () => {}, explain = false }) {
  let last = null, activeSince = 0, watchTimer = null;
  const popped = new Map();           // tabId -> { frame }: popped out by this module, in the small window
  const suppressed = new Set();       // tabId: the person closed its window by hand; not again until they play it again
  const pausedSince = new Set();      // tabId: suppressed and seen paused since (the next play clears the suppression)
  const chain = new Map();            // tabId -> the last step's promise: one step at a time per tab
  const expected = new Set();         // tabId: Acira is about to close its window itself (a return), so it is not "closed by hand"

  const step = (tabId, fn) => { const run = (chain.get(tabId) || Promise.resolve()).then(fn, fn); const tail = run.catch(() => {}); chain.set(tabId, tail); tail.then(() => { if (chain.get(tabId) === tail) chain.delete(tabId); }); return run; };
  const ask = async (frame, script) => { try { return await frame.executeJavaScript(script, true); } catch { return undefined; } };
  const tabOf = id => tabs().find(t => t.id === id);
  const later = (fn, ms = OWN_MS) => { const t = setTimer(fn, ms); t?.unref?.(); };

  async function enter(tabId) {
    const fs = frames(tabId); let found = null;
    for (const frame of fs) { const answer = await ask(frame, QUALIFY_SCRIPT); if (answer && answer.area > (found?.area || 0)) found = { frame, area: answer.area }; }
    if (!found) { if (explain) { const rows = []; for (const frame of fs) { const answer = await ask(frame, EXPLAIN_SCRIPT); if (Array.isArray(answer)) rows.push(...answer); } note({ k: 'no-video', tab: tabId, videos: rows.slice(0, 6) }); } return 'none'; }
    // The person may have come back while the frames were answering: nothing is popped out then.
    if (activeTabId() === tabId) return 'came-back';
    // Chromium closes any other tab's window when this one opens: that exit is ours, not a Back to tab
    const displaced = [...popped.keys()].filter(other => other !== tabId); for (const other of displaced) expected.add(other);
    try { beforePop(tabId); } catch { /* the window is then placed on the page's own signal */ }
    const result = await ask(found.frame, ENTER_SCRIPT);
    if (result !== 'active') { for (const other of displaced) expected.delete(other); return result === 'error' ? 'refused' : 'none'; }
    for (const other of displaced) { popped.delete(other); later(() => expected.delete(other)); }
    try { onPopped(tabId); } catch { /* the small window stays where Chromium put it */ }
    if (activeTabId() === tabId) { expected.add(tabId); await ask(found.frame, EXIT_SCRIPT); expected.delete(tabId); return 'came-back'; }
    popped.set(tabId, { frame: found.frame }); watch();
    return 'popped';
  }
  async function leave(tabId, since) {
    const no = why => { if (explain) note({ k: 'leave', tab: tabId, result: 'skipped', why }); return 'skipped'; };
    if (!setting()) return no('setting-off'); if (popped.has(tabId)) return no('already-popped'); if (suppressed.has(tabId)) return no('closed-by-hand');
    const tab = tabOf(tabId); if (!tab) return no('no-tab'); if (tab.contentKind !== 'web') return no('not-web'); if (tab.media !== 'playing') return no('media-' + tab.media); if (tab.muted) return no('tab-muted');
    if (tab.capturing?.length) return no('capturing');                 // camera, microphone or a screen share: a call
    if (tor(tabId) || tab.privacy === 'tor') return no('tor'); if (fullscreen(tabId)) return no('fullscreen'); if (isCallSite(tab.url)) return no('call-site');
    const playedFor = Math.min(now() - (tab.mediaAt || 0), now() - since);
    if (!(playedFor >= WATCH_MS)) return no('played-' + Math.round(playedFor) + 'ms');
    const result = await enter(tabId); note({ k: 'leave', tab: tabId, result }); return result;
  }
  async function arrive(tabId) {
    const mine = popped.get(tabId); if (!mine) return 'none';
    popped.delete(tabId); expected.add(tabId);
    let result = 'none'; for (const frame of frames(tabId)) { const answer = await ask(frame, EXIT_SCRIPT); if (answer === 'inactive') result = 'returned'; }
    expected.delete(tabId); note({ k: 'arrive', tab: tabId, result }); return result;
  }
  /** Look at the window's front tab: when it changed, the tab that was in front is left and the new one is arrived at. Called after every state change. */
  function sync() {
    const current = activeTabId(); if (current === last) return;
    const previous = last, since = activeSince; last = current; activeSince = now();
    if (previous === null) return;
    if (current) void step(current, () => arrive(current));
    if (previous && !together(previous, current)) void step(previous, () => leave(previous, since));
  }
  /** The small window went away on its own: X (the video was paused with it), Back to tab (still playing, the app active) or a plain return (still playing, another app in front). `seen`: the video's state
   *  in the page's leave event ({ paused, ended }), when there was one. */
  async function windowClosed(tabId, frame, seen) {
    const stoppedAlready = !!seen && (seen.paused || seen.ended);
    if (!stoppedAlready) await new Promise(resolve => { const t = setTimer(resolve, LEAVE_LOOK_MS); t?.unref?.(); });
    const video = stoppedAlready ? { paused: true, ended: !!seen.ended, pip: false } : await ask(frame, VIDEO_STATE_SCRIPT);
    if (video && video.pip) return 'again';            // another entry of the same video (the person popped it out by hand again)
    // The player swapped its video while the window was open: the window's own element says what happened. Paused or ended = the X. Anything else (the page ended the window, an ad's teardown, Back to tab) is a plain return:
    // never a tab selected or a window raised by this path, whatever the active app is (a window that goes away after a swap is not a press we can tell), and nothing is held against the new video.
    if (video && video.swapped && !(video.old && (video.old.paused || video.old.ended))) { suppressed.delete(tabId); note({ k: 'returned', tab: tabId, how: 'swapped' }); return 'returned'; }
    if (!video || video.paused || video.ended || video.swapped) {
      // X pauses the video (Chromium does it): that pause is the one the person's next play follows, and the card's `paused` came BEFORE this point (a window going away and a video pausing land in either order, within
      // a few milliseconds of each other), when nothing was suppressed yet to count it. So it is counted here: the person plays the video again and it may pop out again (24 Nov: it took a second pause and play, and
      // switching the setting off and on did nothing). A video that is gone from the page says nothing about being paused: only a pause seen later counts.
      suppressed.add(tabId); if (video) pausedSince.add(tabId); note({ k: 'closed-by-hand', tab: tabId, how: 'x' }); return 'x';
    }
    suppressed.delete(tabId);
    // the active app is read NOW, after the look: a click on the small window's button activated Acira before the window went away
    if (!active()) { note({ k: 'returned', tab: tabId, how: 'app-not-active' }); return 'returned'; }
    note({ k: 'back-to-tab', tab: tabId });
    if (activeTabId() !== tabId) { try { back(tabId); } catch { /* the window is closing */ } note({ k: 'selected', tab: tabId }); }
    return 'back';
  }
  /** The page said the small window is gone (`leavepictureinpicture`): the fast path. `seen` is { paused, ended } at that moment. Returns false when the exit is not one to look at. */
  function left(tabId, seen) {
    const mine = popped.get(tabId); if (!mine) return false;
    popped.delete(tabId); pausedSince.delete(tabId);
    if (expected.has(tabId)) return false;               // Acira's own exit or displacement: a return
    void step(tabId, () => windowClosed(tabId, mine.frame, seen && typeof seen === 'object' ? { paused: seen.paused === true, ended: seen.ended === true } : undefined));
    return true;
  }
  /** The person closed the small window by hand (or the page ended it). */
  function watch() {
    if (watchTimer || !popped.size) return;
    watchTimer = setTimer(async () => {
      watchTimer = null;
      for (const [tabId, mine] of [...popped]) {
        if (expected.has(tabId)) continue;
        const states = await Promise.all(frames(tabId).map(frame => ask(frame, STATE_SCRIPT)));
        if (!popped.has(tabId) || expected.has(tabId)) continue;
        if (!states.some(Boolean)) { popped.delete(tabId); pausedSince.delete(tabId); void step(tabId, () => windowClosed(tabId, mine.frame)); }
      }
      watch();
    }, WATCH_POLL_MS);
    watchTimer?.unref?.();
  }
  /** Acira's own picture-in-picture request (the card's button, Alt+P): run() makes it and answers 'active' | 'inactive' | ... . Whatever this module popped out is marked for the duration, because the
   *  request may end it (an exit) or displace it (another video's window): that exit is a return, never a Back to tab, whichever way the page's event and the answer arrive. */
  async function ownPip(run) {
    const marked = [...popped.keys()]; for (const tabId of marked) expected.add(tabId);
    let result; try { result = await run(); } finally {
      later(async () => {
        for (const tabId of marked) {
          expected.delete(tabId);
          if (!popped.has(tabId)) continue;
          const states = await Promise.all(frames(tabId).map(frame => ask(frame, STATE_SCRIPT)));
          if (!states.some(Boolean)) { popped.delete(tabId); pausedSince.delete(tabId); }     // the window is gone and the request was ours
        }
      });
    }
    if (result === 'inactive') for (const tabId of marked) { popped.delete(tabId); pausedSince.delete(tabId); }
    return result;
  }
  return {
    sync, left, ownPip,
    /** The tab's media state changed (media-controls): a pause then a play clears "closed by hand". */
    noteMedia(tabId, value) { if (explain) note({ k: 'media', tab: tabId, value, suppressed: suppressed.has(tabId), paused: pausedSince.has(tabId) }); if (!suppressed.has(tabId)) return; if (value === 'paused' || value === null) pausedSince.add(tabId); else if (value === 'playing' && pausedSince.has(tabId)) { suppressed.delete(tabId); pausedSince.delete(tabId); } },
    forget(tabId) { popped.delete(tabId); suppressed.delete(tabId); pausedSince.delete(tabId); chain.delete(tabId); expected.delete(tabId); },
    /** Setting turned off: whatever this module popped out comes back. */
    async off() { suppressed.clear(); pausedSince.clear(); for (const tabId of [...popped.keys()]) await step(tabId, () => arrive(tabId)); },
    dispose() { clearTimer(watchTimer); watchTimer = null; },
    state: () => ({ popped: [...popped.keys()], suppressed: [...suppressed] }),
  };
}

module.exports = { createAutoPip, EXPLAIN_SCRIPT, isCallSite, QUALIFY_SCRIPT, ENTER_SCRIPT, EXIT_SCRIPT, STATE_SCRIPT, VIDEO_STATE_SCRIPT, LEAVE_LOOK_MS, OWN_MS, WATCH_MS, MIN_SECONDS, WATCH_POLL_MS, CALL_HOSTS };
