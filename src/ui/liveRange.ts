/** D145 (Beta 14.2): a range control that is being DRAGGED (the Window opacity slider, ui/useRangeDraft.ts) says so here, and the interface's snapshot path (runtime/client.ts, via ui/sharedMotion.ts
 *  appearanceCrossfades) holds the glass density's own changes out of the whole-frame crossfade while it does. A module of its own so the slider does not pull the motion code into what it imports.
 *  While a hold is on, `data-theme-settle` is on the root, as it is during the crossfade this replaces: no CSS transition restarts on every surface at every step (transient.css). */
let holds = 0;
const root = (): HTMLElement | null => (typeof document === 'undefined' ? null : document.documentElement);
/** Starts a hold; the returned function ends it (once). */
export function holdLiveRange(): () => void {
  if (holds++ === 0) root()?.setAttribute('data-theme-settle', '');
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    // a mode switch that is playing owns the attribute and removes it itself when it ends
    if (--holds === 0 && !root()?.hasAttribute('data-mode-switch')) root()?.removeAttribute('data-theme-settle');
  };
}
/** True while any range control is being dragged in this page. */
export const liveRangeActive = (): boolean => holds > 0;
