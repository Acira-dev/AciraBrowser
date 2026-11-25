/**
 * Beta 14.4 live wallpaper (reported 24 Nov 00:15): the person's own video behind the New Tab, where the picture is (features/newtab/LiveVideo.tsx).
 * Battery is this release's first aim, so it plays ONLY while everything says it should, and costs what a still costs otherwise:
 *   - the New Tab is the visible tab of the active window (`data-window-active`, the page visible);
 *   - the person touched the browser in the last IDLE_MAINS_MS (2 min) on mains power, IDLE_BATTERY_MS (30 s) on battery: a wallpaper that freezes
 *     while a person simply looks at it reads as a fault, so the edge light's 10 s is not used (the team, 00:25); it resumes on the next input
 *     from the same frame;
 *   - motion is not Off (Acira's Reduce motion or the system's);
 *   - macOS Low Power Mode is off;
 *   - on battery only when "Play on battery" is on AND the engine said on import that it decodes this file efficiently (mediaCapabilities powerEfficient).
 * A pause keeps the frame where it is. After RELEASE_AFTER_MS paused while the page cannot be seen (releaseWhen), the frame is kept as a still and the
 * decoder is released (LiveVideo.tsx); on resume the still stays until the video plays again from the same place.
 */
export interface LivePlayInputs {
  /** The New Tab with the video is the tab shown and the page is visible (not minimised, not covered). */ visible: boolean;
  /** This window is the active one (main's `window-active`). */ windowActive: boolean;
  /** How long nobody has touched the browser, in ms (0 while input comes). */ quietMs: number;
  reducedMotion: boolean;
  lowPower: boolean;
  onBattery: boolean;
  /** Settings: "Play on battery" (off by default). */ playOnBattery: boolean;
  /** On import the engine said it decodes this file efficiently. */ powerEfficient: boolean;
}
export type LivePauseReason = 'hidden' | 'inactive' | 'idle' | 'reduced-motion' | 'low-power' | 'battery' | 'not-efficient';
export const IDLE_MAINS_MS = 2 * 60 * 1000;
export const IDLE_BATTERY_MS = 30 * 1000;
/** Paused this long while the page cannot be seen, the video gives its decoder back (its frame stays as a still). */
export const RELEASE_AFTER_MS = 30 * 1000;
/** Whether a pause for this reason lets the decoder go after RELEASE_AFTER_MS: only while nobody can see the page (minimised, covered, the interface
 * hidden). Measured (3 x 60 s, hidden window): a paused video costs what no video costs (CPU 2.2-3.3 % vs 2.2-3.1 %, wakeups 489-543 vs 472-543 a second),
 * and the kept frame comes through a canvas, a few levels off the compositor's own picture of the video: swapping it in where it can be seen would show. */
export const releaseWhen = (reason: LivePauseReason | 'playing'): boolean => reason === 'hidden';
export const idleLimit = (onBattery: boolean): number => onBattery ? IDLE_BATTERY_MS : IDLE_MAINS_MS;

/** Whether the video plays, and if not, the first reason it does not. Pure. */
export function livePlay(i: LivePlayInputs): { play: true } | { play: false; reason: LivePauseReason } {
  if (!i.visible) return { play: false, reason: 'hidden' };
  if (!i.windowActive) return { play: false, reason: 'inactive' };
  if (i.reducedMotion) return { play: false, reason: 'reduced-motion' };
  if (i.lowPower) return { play: false, reason: 'low-power' };
  if (i.onBattery && !i.playOnBattery) return { play: false, reason: 'battery' };
  if (i.onBattery && !i.powerEfficient) return { play: false, reason: 'not-efficient' };
  if (i.quietMs >= idleLimit(i.onBattery)) return { play: false, reason: 'idle' };
  return { play: true };
}

/** The caption under the frame: the file's own name without its ending ("Sea at dusk.mp4" -> "Sea at dusk"). */
export const videoTitle = (name: string): string => { const base = String(name || '').trim(); const cut = base.replace(/\.(mp4|m4v|mov|webm)$/i, '').trim(); return cut || base || 'Video'; };

/** The id a video stands under among the New Tab's pictures. */
export const videoPictureId = (id: string): string => 'video:' + id;
export const isVideoPicture = (id: string | undefined): boolean => typeof id === 'string' && id.startsWith('video:');
