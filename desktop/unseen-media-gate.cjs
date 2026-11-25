'use strict';
// Beta 14: a video in a tab the person has not looked at yet waits; it starts when they go to the tab. A tab that was already playing keeps
// playing when they leave it (music must not stop): nothing here touches a tab once it has been shown.
//
// Chrome, Firefox and Safari get this from the page being hidden (pages like YouTube and Twitch wait for the page to be visible) and from the
// autoplay policy (a page nobody has clicked cannot start sound). Acira's page views are hidden too, but a page that calls play() the moment
// it loads, or that ignores visibility, started anyway. So the rule is kept here, for every way a background tab is made (a link opened in a
// background tab, Ctrl/Cmd+click, middle click, several at once, a tab a page opened, a tab loaded ahead, a woken tab): whatever starts playing
// in a page that has never been shown is paused at once and remembered; the first time the page is shown, the same elements are played
// again, as if the person had just arrived. Everything runs through fixed scripts with no interpolation; no page script is added.
//
// What it cannot hold: sound a page makes with the Web Audio API alone (no media element), which is not a "video" in the sense of the rule.

const { withAll } = require('./media-list.cjs');

const MAX_HOLDS = 60;          // a page that restarts itself every time it is paused is left alone after this many
const HOLD_KEY = "Symbol.for('acira.heldMedia')";

// Beta 14.1: a player's element that was never in the document (Spotify, SoundCloud) is held too (media-list.cjs). What is held is remembered with whether it was in the document at that moment:
// a document element the page has taken out since (a removed video) is not played again, as before; one that never was in the document is.
/** Pauses every media element that is playing, in this frame, and remembers which. Answers how many it paused. */
const HOLD_SCRIPT = withAll(`(()=>{const held=window[${HOLD_KEY}]||(window[${HOLD_KEY}]=new Map());let n=0;for(const m of document.querySelectorAll('video,audio')){if(!m.paused&&!m.ended){if(!held.has(m))held.set(m,m.isConnected);m.pause();n++;}}return n;})()`);
/** Plays again the elements held in this frame that are still where they were (in the document, or never in it) and still paused. Answers how many it started. */
const RELEASE_SCRIPT = `(()=>{const held=window[${HOLD_KEY}];if(!held)return 0;let n=0;for(const [m,was] of held){if((m.isConnected||!was)&&m.paused&&!m.ended){try{const p=m.play();if(p&&p.catch)p.catch(()=>{});n++;}catch(e){}}}held.clear();return n;})()`;

/** `framesOf(wc)`: the frames of a page (media-controls' own list). `run(frame, script, gesture)` resolves to a number or rejects. */
function createUnseenMediaGate({ framesOf, run = (frame, script, gesture) => frame.executeJavaScript(script, gesture), note = () => {} }) {
  const holds = new Map();      // tabId -> how many times this page has been held
  const held = new Set();       // tabIds with something held, waiting for the first visit
  const shown = new Set();      // tabIds the person has arrived at: nothing is held for them any more, even by a pause still in flight
  const sum = async (wc, script, gesture) => {
    if (!wc || wc.isDestroyed?.()) return 0;
    const done = await Promise.allSettled(framesOf(wc).map(frame => run(frame, script, gesture)));
    return done.reduce((n, item) => n + (item.status === 'fulfilled' && Number(item.value) > 0 ? Number(item.value) : 0), 0);
  };
  return {
    /** Something started playing in a page nobody has seen: pause it and remember. Answers how many elements were paused. */
    async hold(tabId, wc) {
      if (shown.has(tabId)) return 0;                         // a late "started playing" for a page the person is already at
      const count = (holds.get(tabId) || 0) + 1;
      if (count > MAX_HOLDS) return 0;
      holds.set(tabId, count);
      note({ k: 'hold-sent', tab: tabId });
      const n = await sum(wc, HOLD_SCRIPT, false);
      note({ k: 'hold-landed', tab: tabId, paused: n, shown: shown.has(tabId) });
      if (n > 0) {
        // The pause takes a few milliseconds to reach the page (2 to 3 ms in the gate log). If the person arrived in the meantime, release() found nothing to start
        // yet: start it now, or a page they are looking at would stay paused. Closed by reasoning and a test; not seen in the real app.
        if (shown.has(tabId)) await sum(wc, RELEASE_SCRIPT, true); else held.add(tabId);
      }
      return n;
    },
    /** The page has been shown for the first time: what was held starts. Answers how many elements were started. */
    async release(tabId, wc) {
      holds.delete(tabId); shown.add(tabId);
      note({ k: 'release', tab: tabId, held: held.has(tabId) });
      if (!held.delete(tabId)) return 0;
      return sum(wc, RELEASE_SCRIPT, true);
    },
    holding: tabId => held.has(tabId),
    forget(tabId) { holds.delete(tabId); held.delete(tabId); shown.delete(tabId); },
  };
}

module.exports = { createUnseenMediaGate, HOLD_SCRIPT, RELEASE_SCRIPT, MAX_HOLDS };
