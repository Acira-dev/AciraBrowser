/** Beta 14 section G: the rules of the icon line-draw that need no DOM (timings, pace, which icon does what, the hover rest).
 * ui/lineIconPlay.ts plays them; tests/line-icons.test.ts checks them.
 *
 * Reference: the website's hero icon (site.js drawIcon): 560 ms per path, 120 + n x 80 ms apart, `cubic-bezier(.65,0,.35,1)`; the
 * icon scales .7 > 1.08 > 1 over 520 ms. In a toolbar that reads as lag, so the same recipe is shortened (the approved samples land in
 * 300-460 ms) and its curve front-loaded, so the first frame after a press already moves. */
import type { SpeedName } from './motionTokens';
import type { LineIconName } from './lineIconSet';

/** The curves. DRAW is the hero's in-out, front-loaded; SETTLE is the hero's icon scale curve; GLIDE is quick out with a long soft landing. */
export const LINE_EASE = { draw: 'cubic-bezier(.45,0,.2,1)', settle: 'cubic-bezier(.3,.9,.4,1)', glide: 'cubic-bezier(.22,1,.36,1)', fill: 'cubic-bezier(.3,0,.2,1)' } as const;

/** Premium timings in milliseconds: the approved sample's own (item07 b14Icons.tsx), icon by icon. Fast takes .7 of them, the sample's `pace()`. */
export const LINE_MS = {
  nudge: 300,
  toStop: 300, toReload: 360,
  settingsGhost: 360,
  sidebar: 340,
  homeDraw: 300, homeStagger: 55, homeGhost: 420, homePop: 360,
  historyRing: 360, historyHands: 420, historyHead: 160, historyHeadDelay: 260, historyGhost: 440,
  downloadShaft: 260, downloadHead: 200, downloadHeadDelay: 90, downloadDrop: 320, downloadGhost: 340,
  newDraw: 240, newGhost: 300, newTurn: 320,
  xDraw: 190, xStagger: 45,
  gearTurn: 460, gearHub: 300,
  pinDraw: 260, pinStagger: 70,
  starFill: 220, starPress: 420, starDrain: 200, starRelease: 260,
  mediaMorph: 300, mediaOut: 160,
} as const;
export type LineTimingKey = keyof typeof LINE_MS;
/** Distances and angles of the motion (not scaled by pace), the sample's: the nudge steps 2 units of the 16 grid; the Reload/Stop morph turns 35 degrees as it goes (it starts
 * at -35 going to Stop and at +35 coming back, and ends at 0); the plus grows out of its centre from -45 degrees at .9 scale. */
export const LINE_MOVE = { nudge: 2, reloadTurn: 35, newTurn: 45, newScale: .9 } as const;

/** The factor every duration is multiplied by: 1 Premium, .7 Fast (the sample's `pace()`), 0 when motion is Off (nothing plays, the state just swaps). */
export const linePace = (speed: SpeedName): number => speed === 'off' ? 0 : speed === 'fast' ? .7 : 1;
/** A duration at a speed (never negative, 0 when off). */
export const lineMs = (key: LineTimingKey, speed: SpeedName): number => LINE_MS[key] * linePace(speed);

/** What pressing each icon does. Everything else has no press behaviour: its press is already answered by a popup or a page.
 * (The reason per icon is in the Beta 14 icon inventory, the design notes.) */
export const PRESS_ICONS: ReadonlySet<LineIconName> = new Set<LineIconName>(['back', 'forward', 'home', 'history', 'bookmark', 'downloads', 'new', 'settings', 'prev', 'next']);
/** The icons that redraw when the pointer rests on them. Chosen for being the ones that invite a click without changing state: "add" and
 * "pin" controls, the tab's close and the sidebar row's "more extensions" button (it opens a list, but its press is answered by that list: the redraw is only an invitation, like the pin). Not the state icons (Reload/Stop, the sidebar toggle, the star: their motion IS the state change),
 * not the arrows (a hover nudge would read as a press), not the icons that open a popup. */
export const HOVER_ICONS: ReadonlySet<LineIconName> = new Set<LineIconName>(['new', 'pin', 'x', 'camera', 'puzzle']);

/** The pointer must rest this long before a hover redraw starts (the brief: start around 120-180 ms and tune it). */
export const HOVER_REST_MS = 140;

/** A control that is still fading in when the pointer reaches it (a tab's x shows as its tab is hovered) is being SEEN for the first time: waiting 140 ms and then
 * redrawing it would hide the x it has just shown and draw it again, a pop (reported 14 Nov). So for such a control the draw starts at once and is its appearance
 * (the strokes draw in while the button fades up); a control that was already shown (the selected tab's x, an x the pointer comes to from its own tab) waits for the
 * pointer to rest and redraws, as the sample does. */
export const SHOWN_OPACITY = 0.98;
export const isAppearing = (opacity: number): boolean => opacity < SHOWN_OPACITY;

export interface Scheduler { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
const realScheduler: Scheduler = { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/** One hovered icon's rest rule. The redraw plays after the pointer has stayed `rest` ms, once per hover (not while it stays, not again
 * until the pointer has left and come back); a pointer that passes over quickly triggers nothing; a press cancels it for the rest of the
 * hover (the press behaviour plays at once and wins). */
export class HoverRest {
  private inside = false;
  private spent = false;
  private timer: unknown = null;
  constructor(private readonly play: () => void, private readonly rest = HOVER_REST_MS, private readonly scheduler: Scheduler = realScheduler) {}
  enter(): void {
    if (this.inside) return;
    this.inside = true; this.spent = false;
    this.timer = this.scheduler.set(() => { this.timer = null; if (this.inside && !this.spent) { this.spent = true; this.play(); } }, this.rest);
  }
  leave(): void { this.inside = false; this.cancel(); }
  press(): void { this.spent = true; this.cancel(); }
  /** True once this hover has played or been pressed (it cannot play again before a leave). */
  get done(): boolean { return this.spent; }
  private cancel(): void { if (this.timer !== null) { this.scheduler.clear(this.timer); this.timer = null; } }
}
