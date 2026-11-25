/** Beta 14, section M: the drawing of a tab group's folder in the sidebar (GroupFolderGlyph.tsx draws it, folders.css times it; tests/group-folder-glyph.test.ts keeps them in step).
 *
 *  the team's choice (13 Nov, brief section M): CLOSED is a plain, clean outline folder with no line through it; OPEN is the "drop front" folder; no papers.
 *  An OUTLINE in one colour, flat: nothing is filled and nothing is white.
 *
 *  The whole glyph is ONE line. It is one path with the same command list in both states, so CSS moves `d` from the closed drawing to the open one number for
 *  number: as the folder opens the front drops and widens out of the back's walls while its top edge (the lip) sweeps across from the right wall to the left one.
 *  The path runs in this order: the back (right wall up, the top edge, the tab, the left wall down); a short piece of lip out to the front's top-left corner;
 *  the front (left side, bottom, right side); the lip, from the front's top-right corner back to the left wall. Closed, the two lip pieces have zero length and
 *  the front's top corners sit on the back's walls, so the path is exactly the closed outline. Nothing is degenerate (no curve with its control points collapsed
 *  on a point), so nothing hooks as it starts to move, and nothing pops: the line is never cut. Closing is the exact reverse: the same `d` transition, on a symmetric
 *  curve, played the other way.
 *
 *  Two drawings of the glyph, because a line is only crisp on a pixel row: `x1` on the 16 grid (1 unit = 1 css px; crisp at 100% and 200%) and `x15` on the 24 unit
 *  grid of 150% (1 unit = 1 device pixel at 150%; every straight line is centred on a whole device pixel). CSS shows the one that matches the screen.
 *  The open shape is S3's drop front moved onto whole pixels with a little less flare, so it stays crisp at the real 16 px size. */

export type FolderGrid = 'x1' | 'x15';
export interface FolderGeo {
  Rb: number; Lb: number;   // the back's right and left walls
  y: number;                // where the back's walls end and the lip runs (the front's top)
  T: number; TT: number;    // the back's top edge, the tab's top
  r: number;                // the back's top corner radius
  Lf: number; Rf: number;   // the front's top-left and top-right x
  s: number;                // how far the front's sides lean (x per y): 0 = upright
  rcy: number; rcx: number; // the front's bottom corner: how far up the side and along the bottom the curve starts
  B: number;                // the bottom edge
  xe: number;               // where the lip ends (closed: on the right wall, zero length; open: on the left wall)
  tab: string;              // the tab, from the back's top edge to the tab's top-left
}
export interface FolderDrawing { /** The viewBox is `0 0 box box`. */ box: number; /** The stroke width in that box's units. */ stroke: number; closed: string; open: string }

/** The whole opening (and the whole closing) lasts this many units; a unit is `--motion-scale` ms (Premium 1.7: 408 ms, Fast .6: 144 ms, Off: instant). */
export const FOLDER_SPAN = 240;
/** The hero title's curve of the website. It is point-symmetric, so closing (the same transition played the other way) is the exact time-reverse of opening. */
export const FOLDER_EASE = 'cubic-bezier(.65,0,.35,1)';

const n = (value: number) => +value.toFixed(3);
const TAB_X1 = 'H8.1Q7.6 4.5 7.3 4.1L6.4 2.9Q6.1 2.5 5.6 2.5';
// x15: x * 1.5, y * 1.5 + .25 (so the top edge lands on 7 and the tab's top on 4: whole device pixels)
const TAB_X15 = 'H12.15Q11.4 7 10.95 6.4L9.6 4.6Q9.15 4 8.4 4';

export const FOLDER_GEOMETRY: Record<FolderGrid, { box: number; stroke: number; closed: FolderGeo; open: FolderGeo }> = {
  x1: {
    box: 16, stroke: 1.25,
    closed: { Rb: 14.5, Lb: 1.5, y: 7, T: 4.5, TT: 2.5, r: 1.5, Lf: 1.5, Rf: 14.5, s: 0, rcy: 1.5, rcx: 1.5, B: 13.5, xe: 14.5, tab: TAB_X1 },
    open: { Rb: 13.5, Lb: 2.5, y: 8.5, T: 4.5, TT: 2.5, r: 1.5, Lf: 1.1, Rf: 14.9, s: .16, rcy: 1.25, rcx: 1.25, B: 13.5, xe: 2.5, tab: TAB_X1 },
  },
  x15: {
    box: 24, stroke: 1.875,
    closed: { Rb: 22, Lb: 2, y: 10, T: 7, TT: 4, r: 2.25, Lf: 2, Rf: 22, s: 0, rcy: 2.25, rcx: 2.25, B: 20, xe: 22, tab: TAB_X15 },
    open: { Rb: 20, Lb: 4, y: 13, T: 7, TT: 4, r: 2.25, Lf: 1.65, Rf: 22.35, s: .16, rcy: 1.875, rcx: 1.875, B: 20, xe: 4, tab: TAB_X15 },
  },
};

/** One path of the glyph: the same command list for every geometry, only the numbers differ. */
export function folderPath(geo: FolderGeo): string {
  const { Rb, Lb, y, T, TT, r, Lf, Rf, s, rcy, rcx, B, xe, tab } = geo;
  const sx = Lf + s * (B - rcy - y), cx = Lf + s * (B - y), cxR = Rf - s * (B - y), sxR = Rf - s * (B - rcy - y);
  return `M${n(Rb)} ${n(y)}V${n(T + r)}Q${n(Rb)} ${n(T)} ${n(Rb - r)} ${n(T)}${tab}H${n(Lb + r)}Q${n(Lb)} ${n(TT)} ${n(Lb)} ${n(TT + r)}V${n(y)}`
    + `H${n(Lf)}L${n(sx)} ${n(B - rcy)}Q${n(cx)} ${n(B)} ${n(cx + rcx)} ${n(B)}H${n(cxR - rcx)}Q${n(cxR)} ${n(B)} ${n(sxR)} ${n(B - rcy)}L${n(Rf)} ${n(y)}H${n(xe)}`;
}

export const FOLDER_DRAWINGS: Record<FolderGrid, FolderDrawing> = {
  x1: { box: FOLDER_GEOMETRY.x1.box, stroke: FOLDER_GEOMETRY.x1.stroke, closed: folderPath(FOLDER_GEOMETRY.x1.closed), open: folderPath(FOLDER_GEOMETRY.x1.open) },
  x15: { box: FOLDER_GEOMETRY.x15.box, stroke: FOLDER_GEOMETRY.x15.stroke, closed: folderPath(FOLDER_GEOMETRY.x15.closed), open: folderPath(FOLDER_GEOMETRY.x15.open) },
};

/** The folder as markup, for DOM built by hand (the carried group's chip): the same two drawings GroupFolderGlyph.tsx renders, in the same `.fg` wrapper. */
export function folderMarkup(open = false): string {
  const grids = (['x1', 'x15'] as const).map(grid => {
    const drawing = FOLDER_DRAWINGS[grid];
    return `<svg class="fg-svg fg-${grid}" width="16" height="16" viewBox="0 0 ${drawing.box} ${drawing.box}" focusable="false"><path class="fg-m" d="${drawing.closed}" style="--dc:path('${drawing.closed}');--do:path('${drawing.open}')"/><path class="fg-c" d="${drawing.closed}"/><path class="fg-o" d="${drawing.open}"/></svg>`;
  }).join('');
  return `<span class="fg"${open ? ' data-open' : ''} aria-hidden="true">${grids}</span>`;
}

/** The closed folder as one closed shape, for the solid chip that follows the pointer while a folder is carried (16 px grid). */
export const FOLDER_SILHOUETTE = FOLDER_DRAWINGS.x1.closed + 'Z';
