import { DotMatrix, type MatrixPreset } from '../../components/DotMatrix';
import type { MatrixTone } from '../../ui/matrixTone';

/** The update's dot matrix, on the toolbar's Update pill and in the update and What's new panels: the dots fill with the real progress, then light a check.
 *  6x6 dots (it was 5x5): the 5x5 check spans four of its five rows, so on the dim grid it hugged the top with an empty row under it and read as stuck
 *  to the top; the 6x6 check is lit on rows 1-4 and columns 0-5, centred on the grid both ways. The dots stay round and clearly there, a little smaller
 *  than before and as far apart (a 7x7 grid made them specks; the old dot-to-cell ratio closed the gaps into bars on a 2x screen). On the pill, which
 *  was too big beside its 12px text, it is 14px (it was 16px); in the panels it fills their 16px icon column, so the title's text edge does not move. */
export const UPDATE_MARK_SIZE = 14, UPDATE_MARK_PANEL_SIZE = 16, UPDATE_MARK_ROWS = 6, UPDATE_MARK_DOT = .58;

export function UpdateMark({ preset, progress, tone, reducedMotion, panel = false }: { preset: MatrixPreset; progress?: number; tone: MatrixTone; reducedMotion: boolean; /** In a panel's icon column rather than on the pill. */ panel?: boolean }) {
  return <DotMatrix preset={preset} size={panel ? UPDATE_MARK_PANEL_SIZE : UPDATE_MARK_SIZE} rows={UPDATE_MARK_ROWS} dot={UPDATE_MARK_DOT} progress={progress} tone={tone} reducedMotion={reducedMotion} />;
}
