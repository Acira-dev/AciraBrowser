import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { FOLDER_DRAWINGS, type FolderGrid } from './folderGlyph';
import './folders.css';

const MOVE_MS = 220;
/** The speed setting's scale (Premium 1.7, Fast .6, Off 0) as the sidebar's own CSS sees it. */
const motionScale = (node: Element | null) => { const value = node ? parseFloat(getComputedStyle(node).getPropertyValue('--motion-scale')) : NaN; return Number.isFinite(value) ? Math.max(0, value) : 1; };

const GRIDS: readonly FolderGrid[] = ['x1', 'x15'];
/** The two ends of the morphing line, as the `d` values CSS moves between (folders.css: `.fg-m` is at `--dc`, and at `--do` while the folder is open). */
const MORPH: Record<FolderGrid, CSSProperties> = {
  x1: { '--dc': `path('${FOLDER_DRAWINGS.x1.closed}')`, '--do': `path('${FOLDER_DRAWINGS.x1.open}')` } as CSSProperties,
  x15: { '--dc': `path('${FOLDER_DRAWINGS.x15.closed}')`, '--do': `path('${FOLDER_DRAWINGS.x15.open}')` } as CSSProperties,
};

/** The folder of a tab group in the sidebar (Beta 14, section M): one outline line in the group's colour, flat, nothing white and no fill. Closed it is a plain
 *  outline folder; open it is the drop-front folder. The line morphs between the two (folders.css moves `d` on the group's open state, so the speed setting scales
 *  it and Off makes it instant); closing is the exact reverse. A tab joining or leaving gives the folder one small bump, as it did before. Decoration only: the
 *  header button already says the group and whether it is open.
 *
 *  `open` is the folder's state: open, or a tab is being carried over it (it draws itself open to take it). Two drawings are in the DOM (100% and 150% grids,
 *  folderGlyph.ts) and CSS shows the one that matches the screen. Under Reduce Motion the line does not travel: the two settled drawings (`.fg-c`, `.fg-o`)
 *  swap with a short cross-fade instead. */
export function GroupFolderGlyph({ count, open }: { count: number; open: boolean }) {
  const root = useRef<HTMLSpanElement>(null), previous = useRef<number | null>(null);
  useLayoutEffect(() => {
    const before = previous.current; previous.current = count;
    if (before === null || before === count) return;
    const ms = MOVE_MS * motionScale(root.current);
    if (ms <= 0) return;
    // The bump: a little larger when a tab came in, a little smaller when one left; it ends where it began.
    root.current?.animate([{ transform: 'scale(1)' }, { transform: `scale(${count > before ? 1.13 : .92})`, offset: .4 }, { transform: 'scale(1)' }], { duration: ms, easing: 'cubic-bezier(.2,0,0,1)' });
  }, [count]);
  return <span ref={root} className="fg" data-open={open || undefined} aria-hidden="true">{GRIDS.map(grid => <FolderSvg key={grid} grid={grid} />)}</span>;
}

function FolderSvg({ grid }: { grid: FolderGrid }) {
  const drawing = FOLDER_DRAWINGS[grid];
  return <svg className={'fg-svg fg-' + grid} width="16" height="16" viewBox={`0 0 ${drawing.box} ${drawing.box}`} focusable="false">
    <path className="fg-m" d={drawing.closed} style={MORPH[grid]} />
    <path className="fg-c" d={drawing.closed} />
    <path className="fg-o" d={drawing.open} />
  </svg>;
}
