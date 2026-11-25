'use strict';
// The main-process half of the one-time "Welcome to Beta 14" screen (brief section AL): what the welcome's own page asks of main, through the one channel 'acira:welcome'
// (window.acira.welcome), and what main tells it back through 'acira:welcome-event' (window.acira.subscribeWelcome). Every dependency is injected (the frost), so the tests use fakes
// and a real window is never needed; main.cjs only wires it.
// The card the welcome shows is the member card (src/features/memberCard, Beta 14): its Copy image, Save picture and Save video go through desktop/member-card-share.cjs
// (the real clipboard and the download engine), not through this service.
//
// Requests (the page -> main). Every request is a plain object with exactly the listed fields; anything else is refused (the call throws).
//   {type:'opened'}   the welcome mounted in the overlay page: the frost starts for this overlay                       -> {ok}
//   {type:'leave'}    the welcome starts leaving: the frost plays its reverse                                          -> {ok:true}
// Events (main -> the page):
//   {type:'frost', phase:'in'}   the frost has begun ramping: the entrance starts with it
//   {type:'away'}                a click on the frost, outside the welcome's frame (an enlarged coin goes back)
//   {type:'leave-request'}       main asks the welcome to leave (requestLeave): the page answers by leaving ({type:'leave'}); if none answers within 600 ms main closes the overlay itself
const LIMITS = Object.freeze({ leaveWaitMs: 600 });
const SHAPES = Object.freeze({ opened: [], leave: [] });

const plain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Checks one request strictly and returns it normalised ({type}); throws a TypeError for anything else. */
function parseRequest(request) {
  if (!plain(request)) throw new TypeError('A welcome request is an object');
  const type = request.type;
  if (typeof type !== 'string' || !Object.hasOwn(SHAPES, type)) throw new TypeError('Unknown welcome request');
  for (const key of Object.keys(request)) if (key !== 'type') throw new TypeError(`A ${type} request has no field ${JSON.stringify(key)}`);
  return { type };
}

/**
 * @param {object} deps
 * @param {{open:Function, leave:Function}} deps.frost  desktop/welcome-frost.cjs
 * @param {(event:object) => void} deps.notify  sends an event to the welcome's page
 * @param {() => object|undefined} deps.getOverlay  the layout's current overlay
 * @param {() => string} deps.getAppearance  'dark' or 'light'
 * @param {() => void} deps.closeOverlay  closes the welcome's overlay at once (requestLeave's fallback)
 */
function createWelcomeService({ frost, notify, getOverlay, getAppearance, closeOverlay, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let leaveTimer = null;
  const cancelLeaveRequest = () => { if (leaveTimer !== null) { clearTimer(leaveTimer); leaveTimer = null; } };
  const send = (event) => { try { notify(event); } catch { /* the page is gone */ } };

  /** The frost layer's own two signals, as the page hears them. */
  function frostEvent(name) {
    if (name === 'in') send({ type: 'frost', phase: 'in' });
    else if (name === 'away') send({ type: 'away' });
  }
  /** Main wants the welcome gone (a window action, a test): ask the page to play its reverse; close the overlay at once if it does not answer. */
  function requestLeave() {
    if (leaveTimer !== null) return;
    const asked = getOverlay();
    send({ type: 'leave-request' });
    leaveTimer = setTimer(() => {
      leaveTimer = null;
      const now = getOverlay();
      if (now?.kind === 'welcome' && now.id === asked?.id) closeOverlay();   // still the same welcome: nobody answered, so it closes at once
    }, LIMITS.leaveWaitMs);
    leaveTimer?.unref?.();
  }

  async function handle(request) {
    const call = parseRequest(request);
    switch (call.type) {
      case 'opened': {
        const overlay = getOverlay();
        if (overlay?.kind !== 'welcome') return { ok: false };
        void frost.open(overlay, getAppearance());
        return { ok: true };
      }
      case 'leave':
        cancelLeaveRequest(); frost.leave();
        return { ok: true };
      default:
        throw new TypeError('Unknown welcome request');
    }
  }

  return { handle, frostEvent, requestLeave, dispose: cancelLeaveRequest };
}

module.exports = { createWelcomeService, parseRequest, LIMITS };
