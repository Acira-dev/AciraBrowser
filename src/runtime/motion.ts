/**
 * Reduce motion, as the interface and main see it (13.5).
 *
 * The person's own choice always wins. Until they have made one, Reduce motion is on while the window is drawn in software
 * (no graphics acceleration: a glide runs at about 5 frames a second there) and off otherwise. The operating system's own
 * Reduce motion setting still turns it on, as before. `reducedMotionChosen` is written by the settings reducer the first time
 * anything sets `reducedMotion`; a profile saved before 13.5 has `reducedMotion: false` and no marker, which is read as "never chosen".
 */
export interface MotionSettings { reducedMotion?: boolean; reducedMotionChosen?: boolean }

export function effectiveReducedMotion(settings: MotionSettings, osReduced: boolean, softwareDrawing: boolean): boolean {
  return !!(settings.reducedMotion || osReduced || (softwareDrawing && !settings.reducedMotionChosen));
}
