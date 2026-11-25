// The dot grids of the transfer sheet (spec 5.1 moments 4, 6, 9, 12), a wrapper over DotMatrix so every screen sizes and tones them the same way.
//   heartbeat  3 x 3 at rest beside "Waiting for your other computer…" (S2)
//   scan       3 x 13 across the pairing strip while the two computers meet (S3; README question 3: `scan` travels left to right, `loader` blooms from the middle)
//   progress   3 x 13: layers light from the middle outward with the verified bytes, glided with the `settle` spring (S4; centre-out is how the preset fills)
//   progressHeld  the same fill held still while a transfer stalls (the next dot stops blinking)
//   check      7 x 7 above the text (S5, the saved screen; the preset exists only for square 5, 6 and 7 grids, README question 4)
// The grid is decorative: `label` makes it an image for a screen reader, otherwise it is hidden from one.
import { DotMatrix, type MatrixPreset } from '../../components/DotMatrix';
import { reducedMotion as reducedMotionNow } from '../../ui/sharedMotion';
import { UpdateMark } from '../updates/UpdateMark';

export interface TransferGridProps {
  /** loader / scan while pairing, heartbeat while waiting, progress while bytes flow, check when done. */
  preset: Extract<MatrixPreset, 'loader' | 'scan' | 'heartbeat' | 'progress' | 'progressHeld' | 'check'>;
  rows: number;
  cols: number;
  /** 0..1, real verified bytes (never moves backwards). */
  fraction?: number;
  /** The next dot stops blinking while a transfer stalls. */
  held?: boolean;
  /** Screen-reader text (the grid itself is decorative). */
  label?: string;
  /** Size of one dot cell in CSS px. Default: 6 for the 3 x 3 heartbeat, 8 for the 7 x 7 check, 14 for the wide strip (3 x 13 is 182 x 42, as drawn). */
  cell?: number;
  /** Animation speed Off / Reduce motion: the grid rests on a still frame. Default: what the app says now. */
  reducedMotion?: boolean;
  className?: string;
}

/** The pixel size of a grid: the cell times its columns and rows. */
export const gridSize = (rows: number, cols: number, cell: number) => ({ width: cols * cell, height: rows * cell });
const defaultCell = (preset: TransferGridProps['preset']) => preset === 'heartbeat' ? 6 : preset === 'check' ? 8 : 14;

export function TransferGrid({ preset, rows, cols, fraction = 0, held = false, label, cell, reducedMotion, className = '' }: TransferGridProps) {
  const shown = preset === 'progress' && held ? 'progressHeld' : preset;
  const { width, height } = gridSize(rows, cols, cell ?? defaultCell(preset));
  return <DotMatrix preset={shown} rows={rows} cols={cols} width={width} height={height} progress={Math.min(1, Math.max(0, fraction))} reducedMotion={reducedMotion ?? reducedMotionNow()} label={label} className={`tx-grid ${className}`.trim()} />;
}

/** The done mark (S5 "Sent", the saved screen): the update's dotted tick on its faint grid (features/updates/UpdateMark.tsx, `check`, panel size: the team's pick of 8 Nov 2026), above the text. It plays its finish once and rests. */
export function CheckGrid({ reducedMotion, label }: { reducedMotion?: boolean; label?: string }) {
  return <div className="tx-grid-check" role={label ? 'img' : undefined} aria-label={label}><UpdateMark panel preset="check" tone="accent" reducedMotion={reducedMotion ?? reducedMotionNow()} /></div>;
}
