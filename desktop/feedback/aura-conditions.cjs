'use strict';
// Beta 14: when the aura may play, and when it must draw back. One pure function, so every rule has a test (tests/feedback-aura-conditions.test.cjs).
//
// Never plays (the brief): in a private window or a Tor window, over fullscreen, while a pop-up or the setup is open, when the window is not focused, during
// screen sharing, or twice for the same mark. Also never when the person turned the points, ranks and aura off in Settings, never in a window that is
// minimized or hidden, never when the pointer is already near the place it would appear (it would draw back at once: it waits for a later chance), and never
// when it has nothing to play (no pending mark or rank).
//
// "Twice for the same mark" is the feedback service's own record (feedback-service.cjs: auraPending / auraDone, kept in the profile's copy): `pending` is the
// id the service still owes this profile ('earlyMember' or 'rank:<rank>'), null when it owes none. This file does not keep a second list.
//
// While it plays, the same function is asked again every tick with the live facts: a blocker that appears mid-play (a pop-up opens, the window loses focus,
// fullscreen, sharing starts, the pointer comes near, Seamless's toolbar is revealed) is an ENDING, never a cut: aura.cjs draws back along the way it came.
const ENDING_ORDER = Object.freeze(['private', 'tor', 'off', 'minimized', 'fullscreen', 'popup', 'setup', 'blurred', 'sharing', 'pointer', 'revealed', 'hidden']);

/** Which facts stop an aura right now. `facts`: {private, tor, off, minimized, fullscreen, popupOpen, setupOpen, focused, screenSharing, pointerNear, seamless, hideable, buttonVisible}.
 * `hideable`: this window can hide the toolbar the profile button is on (Seamless, or "Hide the toolbar"); `seamless`: this aura was started while the button was hidden (it rests where the button will
 * appear); `buttonVisible`: the interface says the button is on screen now (it is told every frame while an aura plays: feedback.aura-follow). A window that cannot hide it is always `true`. */
function blockers(facts) {
  const found = [];
  if (facts.private) found.push('private');
  if (facts.tor) found.push('tor');
  if (facts.off) found.push('off');
  if (facts.minimized) found.push('minimized');
  if (facts.fullscreen) found.push('fullscreen');
  if (facts.popupOpen) found.push('popup');
  if (facts.setupOpen) found.push('setup');
  if (facts.focused === false) found.push('blurred');
  if (facts.screenSharing) found.push('sharing');
  if (facts.pointerNear) found.push('pointer');
  // Seamless hides the toolbar: the aura rests where the button will be, and the moment the toolbar shows it draws back. Where the toolbar is already showing when
  // a Seamless window would start, there is no resting place: that is a "revealed" start, and it does not start.
  if (facts.seamless && facts.buttonVisible) found.push('revealed');
  // The other way round: an aura that started while the toolbar was showing (a hideable window, the button there) and finds it hidden again has nothing to close into: it draws back, into where the button was.
  if (facts.hideable && !facts.seamless && !facts.buttonVisible) found.push('hidden');
  return found.sort((a, b) => ENDING_ORDER.indexOf(a) - ENDING_ORDER.indexOf(b));
}

/** Whether a new aura may start. {ok, reasons}. `pending`: the id the service owes, or null. `id` is the mark being played (the one asked for must be the one owed). */
function canPlay(facts, { id, pending }) {
  if (!pending || !id || pending !== id) return { ok: false, reasons: ['nothing-owed'] };
  const reasons = blockers(facts);
  return { ok: reasons.length === 0, reasons };
}

/** Whether a pointer at (x, y) is near a rectangle (all in the same coordinates): inside it, or within `margin` of it. */
function pointerNearRect(point, rect, margin) {
  if (!point || !rect || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  return point.x >= rect.x - margin && point.x <= rect.x + rect.width + margin && point.y >= rect.y - margin && point.y <= rect.y + rect.height + margin;
}

module.exports = { blockers, canPlay, pointerNearRect, ENDING_ORDER };
