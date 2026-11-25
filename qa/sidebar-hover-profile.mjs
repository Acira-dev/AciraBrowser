// What the sidebar hover gate (qa/sidebar-hover-overlay.mjs) saves into its disposable profile, and which way a closed sidebar comes back in each leg.
//
// Beta 14 (AJ, "When the sidebar is closed") gave a new profile `sidebarClosed: 'mini'` (createInitialState). A Mini sidebar is a rail beside the page that the INTERFACE opens from its own pointer
// events; main's edge poller has no side zone for it (desktop/edge-reveal.cjs enabledEdges: `miniRail ? false`). The gate used to build its profile with createInitialState() and never said which
// one it meant, so on Beta 14 its injected screen pointer (the edge poller's input) had nothing to open and the first case failed on every platform (round 16, merge 5de7ddaab).
// A profile saved before the setting existed reads as Hidden, so both are real: the gate now names the setting and runs both ways.
//   hidden: the closed sidebar comes back from the window's left edge, decided by main's production poller from the (injected) screen pointer. This is the whole of the 13.10 matrix, unchanged.
//   mini:   the closed sidebar is the rail; resting the pointer on it opens the sidebar over the page, decided by the interface from the pointer events it receives. The gate sends those as
//           real input events to the interface's page (CDP Input.dispatchMouseEvent through Playwright's mouse), not as a call into the rail's code.
export const HOVER_CLOSED = ['hidden', 'mini'];

/** The settings the gate's profile starts with, for a leg ('hidden' | 'mini'). */
export function hoverSettings(closed) {
  if (!HOVER_CLOSED.includes(closed)) throw new Error('sidebarClosed must be one of ' + HOVER_CLOSED.join(', '));
  return {onboardingComplete: true, askBeforeClosing: false, verticalTabs: true, reducedMotion: false, animationSpeed: 'fast', sidebarWidth: 240, sidebarClosed: closed, sidebarPeek: {full: true, compact: true, focus: true}};
}
