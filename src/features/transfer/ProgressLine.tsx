// The progress of a transfer, drawn as the update's download is (the team's call, 9 Nov 2026): a row of round dots in the update mark's own look fills with the real progress
// under a travelling shine (features/updates/UpdateLine.tsx, ui/updateLine.ts: not redrawn here). Stalled: the same fill held and dimmed. Animation speed Off and reduced motion: the
// dotted progress, still, with no shine. The row is a progress bar for a screen reader.
import { UpdateLine } from '../updates/UpdateLine';
import { reducedMotion as reducedMotionNow } from '../../ui/sharedMotion';

export interface ProgressLineProps {
  /** 0..1, real verified bytes (or finished steps); never moves backwards. */
  fraction: number;
  /** The transfer stalled: the fill stays where it is, dimmed, and the shine stops. */
  held?: boolean;
  /** Animation speed Off / reduce motion: the fill without the shine. Default: what the app says now. */
  reducedMotion?: boolean;
  /** Screen-reader text for the bar (the dots themselves are decorative). */
  label?: string;
  /** Width of the row in CSS px (its height is the update line's own 4 px). */
  width?: number;
  className?: string;
}

export function ProgressLine({ fraction, held = false, reducedMotion, label, width, className = '' }: ProgressLineProps) {
  const calm = reducedMotion ?? reducedMotionNow(), share = Math.min(1, Math.max(0, fraction));
  // Decorative unless it is given a label: the screens already say their progress in words (S4's "2.4 of 3.1 MB" carries the progressbar role).
  const semantic = label ? { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(share * 100) } : { 'aria-hidden': true as const };
  return (
    <div className={('tx-line ' + (held ? 'is-held ' : '') + className).trim()} style={width ? { width } : undefined} data-held={held ? '' : undefined} {...semantic}>
      <UpdateLine look={held ? 'held' : 'run'} progress={share} running={!held && !calm} still={calm} />
    </div>
  );
}
