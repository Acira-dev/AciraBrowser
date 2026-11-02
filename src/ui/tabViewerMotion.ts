/** The tab viewer's open and close (Alt+T or its toolbar button). Founder, 27 Oct: "the tab viewer is opening from top to
 * bottom with the animation. Just let it open from center outwards." One calm reveal from the centre of the window, the
 * Apple way: the sheet scales up from 96% around its own centre on the `tabViewer.open` spring while its rows appear from
 * the middle outwards (the row nearest the centre first, the header, search and footer last, rows equally far above and
 * below together), and the close reverses into the centre on `tabViewer.close`. There is no clip, wipe or top-down row
 * cascade, and the toolbar button that opened it never moves the origin. Transform and opacity only (SheetPopupSurface). */
import {springAt,springSettle,type SpringSpec} from './springs';

/** Open and close always pivot on the sheet's centre, whatever opened it. */
export const tabViewerOrigin = {x: .5, y: .5} as const;
/** The plane's scale on the first open frame and the last close frame: the full range of the signature condense
 * (sheetFormation `formationLayerPaint` maps .96 → 1 onto the frost and mist). */
export const tabViewerScale = .96;
/** A row starts this fraction of its distance from the centre nearer to it (at most `maxPull` px), so the rows travel
 * outwards with the sheet instead of rising. */
export const tabViewerPull = {fraction: .03, maxPull: 6};

/** Delay (ms) of each row from the offset (px) of its centre from the sheet's centre: 0 in the middle, growing with the
 * distance, `cap` at the sheet's edge (`half` px away) and beyond. Symmetric: rows equally far above and below share a
 * delay, so the stagger radiates from the middle and never runs top to bottom. */
export function centreOutDelays(offsets: readonly number[], half: number, cap: number): number[] {
  const reach = Math.max(1, half);
  return offsets.map(offset => Math.round(Math.max(0, cap) * Math.min(1, Math.abs(offset) / reach) * 100) / 100);
}

/** Where a row starts, in px along y, from its offset from the centre: pulled toward the centre. */
export function centreOutPull(offset: number, fraction = tabViewerPull.fraction, maxPull = tabViewerPull.maxPull): number {
  const pull = -offset * fraction;
  return Math.round(Math.max(-maxPull, Math.min(maxPull, pull)) * 100) / 100 || 0;
}

/** The spring as a progress curve over elapsed milliseconds (0 → 1), and the time it takes to settle: the formation's
 * scale rides this instead of a fixed ease, so the sheet moves on the shared motion token. `velocity` is the launch kick
 * (fraction of the travel per second). */
export function springCurve(spec: SpringSpec, velocity = 0): {duration: number; at: (ms: number) => number} {
  const duration = Math.round(springSettle(spec, .004, velocity) * 1000);
  return {duration, at: ms => ms >= duration ? 1 : springAt(spec, 0, 1, Math.max(0, ms) / 1000, velocity).value};
}
