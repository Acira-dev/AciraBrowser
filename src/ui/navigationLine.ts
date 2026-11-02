/*
 * The loading line's state rule, with no DOM in it (the painter is src/components/NavigationProgress.tsx).
 *
 * The line belongs to the main frame's navigation and to nothing else. It begins when a navigation starts, advances with
 * the navigation's progress, and when the tab stops loading it either runs to the end and exits (the main frame
 * finished) or exits where it is (the load was cancelled or failed). Once the exit has finished the line is over, and
 * only a new navigation brings it back: a long poll, an event stream, beacons or a subframe that loads after the main
 * frame has finished never reach `lineStep` as a loading tab, so they cannot start or extend it.
 */
export const MIN_PROGRESS = .05, EXIT_START = .9, RESTING_PULSE = .5, PROGRESS_MS = 180, PULSE_MS = 700, FADE_MS = 320;
// A load that has stopped moving (a page that never finishes: video sites, long polls) stops pulsing after this long and rests, instead of redrawing a blurred glow every frame for as long as the tab is open.
export const CALM_MS = 6000;
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3), easeInOut = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** One navigation's line: begin, advance, finish (run to the end, then exit) or cancel (exit where it is). */
export class Line {
  active = false; finishing = false; start = 0; target = 0; progressAt = 0; fadeAt = 0; pulseAt = 0; pulseStart = 0; reduced = false;
  displayed(now: number) { if (this.reduced) return this.target; const t = Math.min(1, (now - this.progressAt) / PROGRESS_MS); return lerp(this.start, this.target, easeOut(t)); }
  fade(now: number) { if (!this.fadeAt) return 1; if (this.reduced) return 0; return 1 - easeOut(Math.min(1, (now - this.fadeAt) / FADE_MS)); }
  calm(now: number) { return !this.finishing && !this.fadeAt && now - this.progressAt > CALM_MS && now - this.pulseStart > CALM_MS; }
  pulse(now: number) { if (this.reduced || this.finishing || this.calm(now)) return RESTING_PULSE; const u = ((now - this.pulseAt) / PULSE_MS) % 2, p = u < 1 ? u : 2 - u; return easeInOut(p); }
  begin(progress: number, now: number) { this.pulseStart = now; this.active = true; this.finishing = false; this.fadeAt = 0; this.start = 0; this.target = 0; this.pulseAt = now - PULSE_MS * RESTING_PULSE; this.set(Math.max(progress, MIN_PROGRESS), now); }
  set(progress: number, now: number) { if (progress <= this.target) return; this.start = this.displayed(now); this.target = Math.min(1, progress); this.progressAt = now; }
  finish(now: number) { if (!this.active || this.finishing) return; this.finishing = true; this.set(1, now); }
  cancel(now: number) { if (!this.active) return; this.finishing = true; this.start = this.target = this.displayed(now); if (!this.fadeAt) this.fadeAt = now; }
  /** Helium starts the exit once the run to the end passes 90%; the line is over when its exit has faded out. */
  tick(now: number) { if (this.finishing && !this.fadeAt && this.displayed(now) >= EXIT_START) this.fadeAt = now; if (this.fadeAt && this.fade(now) <= 0) this.active = false; }
  /** The painter must keep drawing frames: running (not resting) or inside its exit. A line that is over, or resting on a load that stopped moving, needs none. */
  animating(now: number) { return this.active && !this.calm(now); }
}

/** What the tab's loading state means for the line. `loading` is the main frame's navigation (the tab's `loading` and not a failed page), `progress` its 0..1 estimate. */
export type LineStep = 'begin' | 'advance' | 'finish' | 'cancel' | 'none';
export function lineStep(
  now: { loading: boolean; progress?: number; web: boolean; error: boolean },
  before: { loading: boolean; progress?: number },
  line: Pick<Line, 'active'>,
): LineStep {
  // A navigation that restarts below where the line already is (a replacement or redirect to a new load) begins again.
  if (now.loading && (!before.loading || !line.active || (now.progress ?? 0) + .05 < (before.progress ?? 0))) return 'begin';
  if (now.loading) return now.progress !== undefined ? 'advance' : 'none';
  if (before.loading) return now.web && now.progress !== undefined && now.progress >= 1 && !now.error ? 'finish' : 'cancel';
  return 'none';
}
