/** R4-14: the Compact window view's expand / collapse controller as one explicit state machine (spec:
 * docs/launch/COMPACT_MODE_UX.md). Pure: App feeds it events through `useCompactChrome`, which owns the timers and plays the
 * change on the layout spring. tests/compact-chrome.test.ts walks every entry and exit path.
 *
 *  collapsed  the one 32px row (rest). The pointer never changes the layout: hovering or clicking anything in the row (the
 *             address field, a button, a tab chip, a menu) keeps the row exactly where it is.
 *  expanded   the full chrome (tab strip + toolbar) for a moment that wants every tab title: a new tab, Ctrl+Tab, Ctrl+L.
 *
 * Pins (an open menu or popup, a drag, focus in the address field, the pointer moving over the chrome) hold the expanded
 * chrome; when the last pin goes, a short grace runs before it collapses. Explicit ends (Enter, Esc, a click in the page,
 * switching tabs) collapse at once. */
export type CompactPhase = 'collapsed' | 'expanded';
export type CompactReason = 'new-tab' | 'cycle' | 'address';
export type CompactPin = 'popup' | 'drag' | 'address' | 'pointer';
/** The timer the state is waiting on: `settle` gives a keyboard expansion time to be taken up (focus lands), `grace` follows
 * the last pin letting go, `cycle` follows the last Ctrl+Tab step. */
export type CompactDue = 'settle' | 'grace' | 'cycle' | null;
export interface CompactState { phase: CompactPhase; reason: CompactReason | null; pins: readonly CompactPin[]; due: CompactDue }
export type CompactEvent =
  | { type: 'new-tab' } | { type: 'cycle' } | { type: 'address-key' }
  | { type: 'commit' } | { type: 'escape' } | { type: 'page' } | { type: 'switch' } | { type: 'blur' }
  | { type: 'pin'; pin: CompactPin; on: boolean }
  | { type: 'timeout'; due: Exclude<CompactDue, null> }
  | { type: 'reset' };

/** Milliseconds before each timer fires (before the speed setting; timers are intent, not motion, so they never stretch). */
export const compactTimings = { settle: 1200, grace: 450, cycle: 1000 } as const;
export const compactRest: CompactState = { phase: 'collapsed', reason: null, pins: [], due: null };

const withPin = (pins: readonly CompactPin[], pin: CompactPin, on: boolean): readonly CompactPin[] =>
  on ? (pins.includes(pin) ? pins : [...pins, pin]) : pins.includes(pin) ? pins.filter(item => item !== pin) : pins;
const collapse = (state: CompactState): CompactState => ({ ...state, phase: 'collapsed', reason: null, due: null });
/** A keyboard expansion starts without the pointer pin: a pointer that was resting on the row before the key is not using the
 * chrome (it would hold Ctrl+Tab's strip open until it moved away); it pins again the moment it moves over the chrome. */
const expand = (state: CompactState, reason: CompactReason): CompactState => {
  const pins = withPin(state.pins, 'pointer', false);
  return { ...state, pins, phase: 'expanded', reason, due: reason === 'cycle' ? 'cycle' : pins.length ? null : 'settle' };
};

export function compactStep(state: CompactState, event: CompactEvent): CompactState {
  switch (event.type) {
    case 'new-tab': return expand(state, 'new-tab');
    case 'address-key': return expand(state, 'address');
    case 'cycle': return expand(state, 'cycle');
    case 'commit': case 'page': return state.phase === 'collapsed' ? state : collapse(state);
    // Esc closes the innermost thing first: with a menu open it is the menu's (the pin lets go and the grace follows).
    case 'escape': return state.phase === 'collapsed' || state.pins.includes('popup') ? state : collapse(state);
    // Ctrl+Tab moves the active tab while the strip shows: that is the cycle itself, so its timer restarts instead.
    case 'switch': return state.phase === 'expanded' && state.reason === 'cycle' ? { ...state, due: 'cycle' } : state.phase === 'collapsed' ? state : collapse(state);
    case 'blur': {
      // Leaving the window is leaving the chrome: the pointer and the field's focus no longer hold it (the field keeps its
      // text and focus in the one row; coming back does not expand it again).
      const pins = withPin(withPin(state.pins, 'pointer', false), 'address', false);
      if (state.phase === 'collapsed') return pins === state.pins ? state : { ...state, pins };
      // A menu drawn in its own window or a drag outside the window takes focus away on purpose; they keep the chrome.
      return { ...state, pins, due: pins.includes('popup') || pins.includes('drag') ? null : 'grace' };
    }
    case 'pin': {
      const pins = withPin(state.pins, event.pin, event.on);
      if (pins === state.pins) return state;
      if (state.phase === 'collapsed') return { ...state, pins };
      if (event.on) return { ...state, pins, due: null };
      return { ...state, pins, due: pins.length ? null : 'grace' };
    }
    case 'timeout':
      if (state.phase === 'collapsed' || state.due !== event.due) return state;
      return state.pins.length ? { ...state, due: null } : collapse(state);
    case 'reset': return state.phase === 'collapsed' && !state.due ? state : { ...compactRest, pins: state.pins };
  }
}
