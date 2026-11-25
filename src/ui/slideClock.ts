// 13.11 round 7 (laptop, Run 10, frames in the design notes): on a Windows launch's first reveal the slide's frames do not reach the screen for ~200-230 ms (the second reveal ~100-120 ms): the page has
// swapped to its picture, nothing of the sidebar is there yet, and when its first frame finally shows the slide is already 110-228 px in (31-64 px on the second reveal). The view transition's animations run on
// their own clock from `ready`; whatever keeps the first frames back (the compositor activating the new layers late, a raster, a presentation stall), the clock does not wait for it.
// A frame that comes late is the sign: the main thread's frames wait for the compositor, so a gap of more than GAP_MS between two frames right after `ready` means the layers were not on screen for that long.
// The slide then starts again from 0 at the frame that ends the gap: the wait stays, nobody sees a jump. At most MAX_RESTARTS times, and only in the first WATCH_MS after `ready`.
// OFF BY DEFAULT since the laptop's Run 11 (17 Nov): the late frame at clock 79-103 ms had already been presented when the restart came, so in 7 of 11 first reveals the sidebar SNAPPED BACK (share 53 -> 30 %,
// 58 -> 20 %) and the reveal took 80-100 ms longer. The watch stays (gaps, frames: the [edge-frames] and [edge-step] trace); only the restart waits for a proof that the frame it answers was not yet shown.
export const GAP_MS = 48;          // a normal first frame of a transition takes 26-43 ms on the Mac; a 60 Hz frame 16
export const WATCH_MS = 700;       // the slide lasts 280-340 ms: nothing is restarted after the slide has had its chance
export const MAX_RESTARTS = 2;
export const DEFAULT_RESTARTS = 0;   // the restart is off (see above); a caller can ask for up to MAX_RESTARTS

type Note = (name: string, extra?: string) => void;
type Transition = { ready: Promise<unknown>; finished: Promise<unknown> };
export type ClockRun = { gaps: number[]; restarts: number; frames: Array<[number, number]> };   // frames: [ms since ready, the slide's furthest animation in ms] for the first 40 frames (the trace)

const liveAnimations = (): Animation[] => (typeof document.getAnimations === 'function' ? document.getAnimations() : []);
/** Put every animation of the transition's pseudo-elements back at its start (the old and new layers, the groups: the whole slide together). */
export function restartSlide(): number {
  let n = 0;
  for (const animation of liveAnimations()) {
    const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
    if (pseudo && pseudo.includes('view-transition')) { animation.currentTime = 0; n++; }
  }
  return n;
}

/** Watch the frames after the transition's ready; returns the run's numbers (for tests and the trace). */
export function watchSlideClock(transition: Transition, note?: Note, maxRestarts = DEFAULT_RESTARTS): ClockRun {
  const run: ClockRun = { gaps: [], restarts: 0, frames: [] };
  if (typeof document.getAnimations !== 'function') return run;   // an engine that cannot say which animations run has nothing to put back
  let over = false, frame = 0;
  const stop = () => { over = true; if (frame) cancelAnimationFrame(frame); };
  void transition.finished.then(stop, stop);
  void transition.ready.then(() => {
    if (over) return;
    const start = performance.now();
    let last = start;
    const tick = () => {
      if (over) return;
      const at = performance.now(), gap = at - last;
      last = at;
      if (at - start > WATCH_MS) { stop(); return; }
      if (gap > 16) run.gaps.push(Math.round(gap));
      if (run.frames.length < 40) { let furthest = -1; for (const animation of liveAnimations()) { const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement; if (pseudo && pseudo.includes('view-transition')) furthest = Math.max(furthest, Math.round(Number(animation.currentTime) || 0)); } run.frames.push([Math.round(at - start), furthest]); }
      if (gap > GAP_MS && run.restarts < Math.min(maxRestarts, MAX_RESTARTS) && restartSlide()) { run.restarts++; note?.('clock-restart-' + run.restarts, `${Math.round(gap)} ms frame gap at ${Math.round(at - start)}`); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }, () => {});
  return run;
}
