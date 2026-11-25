/** Beta 14 section AG: the Ctrl+Tab viewer with page pictures. The sizes and the layout rule are the approved sample's (round 4, "two glass sections only"),
 *  value for value; the sample's layout code is ported here, never imported. Interface px.
 *  Upper section: the page 640 x 400 (radius 16, 10 px in, so 16 + 10 = the section's 26) with its name attached (66 px). Lower section: a slim dock, only the row of small
 *  pictures (96 x 60, 7 px above a 14 px icon, 14 px apart, 14 px padding each side, 14 px above the pictures and 14 below the icons), 4 px narrower on each side than the row,
 *  radius 24. 12 px of real page between the two sections. Five whole items at most (never fewer than three), so nothing is cut at the row's end. */
export const R4 = { thumb: [96, 60], icon: 14, iconGap: 7, gap: 14, padX: 14, padY: 14, side: 4, sectionGap: 12, upperPad: 10, titleH: 66 } as const;

export function r4Layout(count: number, viewport: { width: number; height: number }) {
  const itemH = R4.thumb[1] + R4.iconGap + R4.icon;
  const n = Math.max(3, Math.min(5, Math.floor((viewport.width - 48 - 2 * R4.padX - 2 * R4.side + R4.gap) / (R4.thumb[0] + R4.gap))));
  const rowW = n * R4.thumb[0] + (n - 1) * R4.gap + 2 * R4.padX, lowerW = rowW + 2 * R4.side, lowerH = 2 * R4.padY + itemH;
  let prevW = Math.min(640, viewport.width - 48 - 2 * R4.upperPad), prevH = Math.round(prevW * 10 / 16);
  const fixed = R4.upperPad + R4.titleH + R4.sectionGap + lowerH, room = viewport.height - 132 - fixed;
  if (prevH > room) { prevH = Math.max(160, room); prevW = Math.round(prevH * 16 / 10); }
  const upperW = prevW + 2 * R4.upperPad;
  return { n, rowW, lowerW, lowerH, itemH, prevW, prevH, upperW, width: Math.max(upperW, lowerW), height: fixed + prevH, count: Math.max(1, count) };
}

/** The viewer's timings, the sample's (B14R4Switcher.tsx and b14-r4.css): the page and its name cross-fade over SINGLE_FADE ms for a lone step and RUN_FADE ms when the previous step
 *  was less than RUN_MS ago; the highlight of the picture stepped onto comes in over LIT_IN ms, the one just left goes out over LIT_OUT ms; the row moves by whole items in ROW_MS. */
export const MOTION = { RUN_MS: 260, SINGLE_FADE: 120, RUN_FADE: 70, LIT_IN: 65, LIT_OUT: 85, ROW_MS: 120, ARRIVE_MS: 140, LEAVE_MS: 140, CLOSE_AFTER_MS: 150 } as const;

/** A pointer move that is the person's. When a viewer appears under a resting mouse, Chromium sends the pointer one move at the same spot once the layout settles; taken as a hover it moved the highlight to
 *  whatever lay under the mouse (a row, a picture), away from the tab the keys had reached, and in Recently used the release then switched to it (D188). The first move a viewer sees is only where the pointer
 *  already is (it sets the baseline and hovers nothing), and a later one hovers only if it went somewhere: the same spot, again and again, is not a move. A person's hand always goes somewhere, so
 *  hover and click work as before. (The first try, "movement is not 0", killed the hover in a real-app run: not every move carries one.) Pure; `memory` lives with the viewer. */
export type PointerMemory = { seen: boolean; x: number; y: number };
export const newPointerMemory = (): PointerMemory => ({ seen: false, x: 0, y: 0 });
export function pointerMoved(memory: PointerMemory, event: { clientX: number; clientY: number }): boolean {
  const moved = memory.seen && (event.clientX !== memory.x || event.clientY !== memory.y);
  memory.seen = true; memory.x = event.clientX; memory.y = event.clientY;
  return moved;
}

/** Which tab the row starts on so the current picture is whole and in view (the sample's initial `first`). */
export const firstVisible = (index: number, n: number, count: number) => Math.max(0, Math.min(index - n + 1, count - n));
/** The row scrolls by whole items and keeps one neighbour showing ahead of the current picture when there is one, so the item scrolled in is never the current one (the sample's rule). */
export function rowFirst(first: number, index: number, n: number, count: number) {
  const max = Math.max(0, count - n);
  let next = first;
  if (index <= first) next = index - 1; else if (index >= first + n - 1) next = index - n + 2;
  return Math.max(0, Math.min(max, next));
}
/** A site colour the highlight can show on this surface: too dark on a dark panel (GitHub's black) or too pale on a light one falls back to the accent, so the lines never vanish. */
export function legible(color: string | undefined, dark: boolean) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color || '');
  if (!m) return undefined;
  const [r, g, b] = [m[1], m[2], m[3]].map(h => { const c = parseInt(h, 16) / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  const lum = .2126 * r + .7152 * g + .0722 * b;
  return dark ? (lum < .06 ? undefined : color) : (lum > .7 ? undefined : color);
}
