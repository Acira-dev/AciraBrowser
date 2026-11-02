/** The sidebar media card's volume slider (founder, 27 Oct: "click the speaker, the whole card turns into a volume slider; let
 * go, it waits a bit and goes back to the card"). Everything here is plain logic so it can be tested without a window: the
 * panel's open/close timing, the level a pointer, a key or the wheel asks for, and the order commands reach the page in.
 *
 * Main applies the level to the tab's media elements (desktop/media-controls.cjs, `action: 'volume'`); 0 is the tab's mute,
 * so the equaliser and the tab's sound badge say so. Levels live in memory for the window's life and go with their tab. */

/** After the pointer lets go (or the last key or wheel step), the slider waits this long, then becomes the card again. */
export const VOLUME_HOLD_MS = 1200;
/** Opened with a click and never touched: a little longer, so there is time to reach for it. */
export const VOLUME_IDLE_MS = 2600;
export const VOLUME_STEP = .05, VOLUME_PAGE_STEP = .1;
/** The thumb's diameter in CSS px: the level runs between its centre at either end of the track. */
export const VOLUME_THUMB = 12;

export interface VolumePanel {
  open: boolean;
  /** A pointer is down on the slider: never close while it is held. */
  pressing: boolean;
  /** Opened from the keyboard: no timer (nothing on screen should leave while someone is tabbing through it); Esc or
   * moving focus away closes it. */
  keyboard: boolean;
  /** When the slider becomes the card again (ms on the caller's clock), or null for not on a timer. */
  closeAt: number | null;
}
export const closedPanel: VolumePanel = Object.freeze({ open: false, pressing: false, keyboard: false, closeAt: null });

export type VolumeInput =
  | { type: 'open'; keyboard?: boolean }
  | { type: 'press' }
  | { type: 'release' }
  /** A wheel step, a key, a click on the mute glyph: the wait starts again. */
  | { type: 'nudge' }
  | { type: 'escape' }
  /** The sidebar closed, Seamless hid it, or focus left the card. */
  | { type: 'leave' }
  /** The timer fired. */
  | { type: 'tick' };

/** The slider's state machine. Pure: `now` is the caller's clock. */
export function stepPanel(panel: VolumePanel, input: VolumeInput, now: number): VolumePanel {
  switch (input.type) {
    case 'open': return panel.open ? panel : { open: true, pressing: false, keyboard: !!input.keyboard, closeAt: input.keyboard ? null : now + VOLUME_IDLE_MS };
    case 'press': return panel.open ? { ...panel, pressing: true, closeAt: null } : panel;
    case 'release': return panel.open ? { ...panel, pressing: false, closeAt: panel.keyboard ? null : now + VOLUME_HOLD_MS } : panel;
    case 'nudge': return panel.open && !panel.pressing ? { ...panel, closeAt: panel.keyboard ? null : now + VOLUME_HOLD_MS } : panel;
    case 'escape': case 'leave': return panel.open ? closedPanel : panel;
    case 'tick': return panel.open && !panel.pressing && panel.closeAt !== null && now >= panel.closeAt ? closedPanel : panel;
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Levels are whole percent: what the page gets is what the number says. */
export const roundLevel = (value: number): number => Math.round(clamp01(Number.isFinite(value) ? value : 0) * 100) / 100;

/** The level under a pointer at `x` on a track box: the thumb's centre follows the pointer, so either end is reachable
 * without overshooting the track. */
export function levelAt(x: number, track: { left: number; width: number }, thumb = VOLUME_THUMB): number {
  const run = track.width - thumb;
  return run > 0 ? roundLevel((x - track.left - thumb / 2) / run) : 0;
}

/** The level a key asks for (the WAI-ARIA slider keys), or null when the key is not a slider key. */
export function keyLevel(level: number, key: string): number | null {
  switch (key) {
    case 'ArrowRight': case 'ArrowUp': return roundLevel(level + VOLUME_STEP);
    case 'ArrowLeft': case 'ArrowDown': return roundLevel(level - VOLUME_STEP);
    case 'PageUp': return roundLevel(level + VOLUME_PAGE_STEP);
    case 'PageDown': return roundLevel(level - VOLUME_PAGE_STEP);
    case 'Home': return 0;
    case 'End': return 1;
    default: return null;
  }
}

/** The level a wheel step asks for: one mouse notch (100px) is one key step; a trackpad's small deltas move it smoothly.
 * Up or right is louder. */
export function wheelLevel(level: number, deltaY: number, deltaX = 0): number {
  const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : -deltaX;
  return roundLevel(level - delta * (VOLUME_STEP / 100));
}

/** The leading glyph: a crossed speaker when silent, one wave below half, two from half up. */
export type VolumeGlyphLevel = 'mute' | 'low' | 'high';
export const volumeGlyph = (value: number, muted: boolean): VolumeGlyphLevel => muted || value <= 0 ? 'mute' : value < .5 ? 'low' : 'high';

/** What the slider shows for a tab: 0 while the tab is muted (whatever the level underneath), else its level. */
export const shownLevel = (level: number, muted: boolean): number => muted ? 0 : level;

/** The level the person last chose per tab, in memory only (private and Tor tabs too: nothing is ever written). A tab that
 * was never set reads as unknown, so the slider can start from what the page itself plays at. */
const levels = new Map<string, number>();
export const rememberedLevel = (tabId: string): number | undefined => levels.get(tabId);
export function rememberLevel(tabId: string, level: number): void { levels.set(tabId, roundLevel(level)); }
/** Closed tabs lose their level. */
export function forgetLevels(live: Iterable<string>): void {
  const keep = new Set(live);
  for (const id of [...levels.keys()]) if (!keep.has(id)) levels.delete(id);
}

/** What moving the slider to `value` does, for a tab that is `muted` with `level` underneath, a gesture that started at
 * `start`: the level to remember, the level the page's media elements get (null: leave them), and whether to mute or
 * unmute the tab (null: neither). Reaching 0 mutes the tab and keeps the level from before the gesture, so unmuting later
 * comes back at a level that can be heard (Control Center's rule); leaving 0 sets the level first, then unmutes. */
export interface VolumeChange { level: number; page: number | null; mute: boolean | null }
export function volumeChange(value: number, tab: { muted?: boolean; level: number; start: number }): VolumeChange {
  const next = roundLevel(value);
  if (next <= 0) return { level: tab.start > 0 ? tab.start : tab.level > 0 ? tab.level : .5, page: null, mute: tab.muted ? null : true };
  return { level: next, page: next, mute: tab.muted ? false : null };
}

/** The mute glyph inside the slider: muting keeps the level; unmuting from a level of 0 comes back at half. */
export function muteToggle(tab: { muted?: boolean; level: number }): VolumeChange {
  if (tab.muted) { const level = tab.level > 0 ? tab.level : .5; return { level, page: level, mute: false }; }
  return { level: tab.level, page: null, mute: true };
}

/** Sends levels to the page one at a time, newest wins: while one is on its way, later ones replace each other, so a fast
 * drag never queues up stale levels; `after` runs once everything sent so far has landed (an unmute waits for the level
 * it should be heard at). Never throws. */
export function createVolumeSender(send: (level: number) => Promise<unknown>) {
  let pending: number | null = null, busy: Promise<void> | null = null;
  const pump = (): Promise<void> => {
    if (!busy) busy = (async () => {
      for (let guard = 0; pending !== null && guard < 1000; guard++) {
        const level = pending; pending = null;
        try { await send(level); } catch { /* a page that refuses is just not moved */ }
      }
    })().finally(() => { busy = null; if (pending !== null) void pump(); });
    return busy;
  };
  return {
    set(level: number): void { pending = roundLevel(level); void pump(); },
    after(run: () => void): void { void pump().then(run, run); },
    get idle(): boolean { return !busy && pending === null; },
  };
}
