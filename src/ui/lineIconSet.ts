/** Beta 14 section G: the single-line icon set. Pure data and geometry, no DOM, so a test can check every drawing.
 *
 * Every icon is a centre-line drawing on the website's 16 grid (stroke 1.25 on the 16 grid = 1.4 px at the toolbar's 18 px, the hero line's weight),
 * round caps and joins. Each path is drawn with `pathLength=1` so one dash recipe draws any of them (ui/lineMotion.ts).
 *
 * The drawings of the approved sample (beta14-samples/item07, b14Icons.tsx `LINE`) are its path data, character for character: Back, Forward, Reload, Stop,
 * Home, the sidebar toggle (both states), the star, Downloads, the plus, the tab ×, the Settings gear and History. The one change is the one the brief asks for:
 * the Reload arrowhead (see `RELOAD_*` below). The icons the sample did not draw (the clock, the tab, the arrow, the bookmark, the pin, the media set, the
 * camera) are made here, from helpers that compute circles and arrowheads. A drawing that has a pressed or morphing partner (Reload/Stop, the sidebar toggle
 * open/closed, Play/Pause) keeps the same command structure in both states, so the browser can interpolate the `d` of one into the other: a true morph. */

export const LINE_GRID = 16;
/** Stroke width on the 16 grid: the sample's 1.25 (1.4 px at the toolbar's 18 px, the website's weight). */
export const LINE_STROKE = 1.25;

export interface LinePath {
  /** The path data. */
  d: string;
  /** A name the motion code can address (`hands`, `divider`, `arrow`, ...). */
  role?: string;
  /** Closed shapes that take a fill (the saved star): the outline draws first, then the fill comes in. */
  fill?: boolean;
  /** A class name for the path, for the few callers whose own CSS addresses one part (the suggestions' clock winds its ring and swings its hands into a ×). Rare on purpose. */
  cls?: string;
}

const round = (n: number): number => Math.round(n * 100) / 100;
const pt = (x: number, y: number): string => `${round(x)} ${round(y)}`;
const rad = (deg: number): number => deg * Math.PI / 180;

/** A circular arc as cubic Beziers of at most 90 degrees. Angles are in degrees, 0 at the right, y down; a positive sweep runs
 * clockwise on the screen. Returns `M x y C ...`. */
export function arcPath(cx: number, cy: number, r: number, from: number, sweep: number, segments = Math.max(1, Math.ceil(Math.abs(sweep) / 90))): string {
  const step = sweep / segments, k = 4 / 3 * Math.tan(rad(step) / 4), at = (a: number): [number, number] => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
  const tangent = (a: number): [number, number] => [-Math.sin(rad(a)), Math.cos(rad(a))];
  let d = `M${pt(...at(from))}`;
  for (let i = 0; i < segments; i++) {
    const a0 = from + step * i, a1 = a0 + step, p0 = at(a0), p1 = at(a1), t0 = tangent(a0), t1 = tangent(a1);
    d += `C${pt(p0[0] + k * r * t0[0], p0[1] + k * r * t0[1])} ${pt(p1[0] - k * r * t1[0], p1[1] - k * r * t1[1])} ${pt(p1[0], p1[1])}`;
  }
  return d;
}
/** The point at angle `a` of a circle. */
export const onCircle = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];

/** A straight line written as `segments` cubics (controls at thirds), so it can morph from, or into, an arc of the same structure. */
export function lineAsCubics(x0: number, y0: number, x1: number, y1: number, segments = 4): string {
  let d = `M${pt(x0, y0)}`;
  for (let i = 0; i < segments; i++) {
    const a = i / segments, b = (i + 1) / segments, s = (b - a) / 3;
    const p = (u: number): [number, number] => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
    d += `C${pt(...p(a + s))} ${pt(...p(b - s))} ${pt(...p(b))}`;
  }
  return d;
}

/** An arrowhead: the tip, the direction the arrow points in (degrees, y down) and the arm length. The arms leave the tip at
 * exactly 45 degrees either side of the way back, so the head is symmetric about the stroke it ends. `M arm L tip L arm`. */
export function headPath(tipX: number, tipY: number, pointing: number, arm: number): string {
  const back = pointing + 180, a = onCircle(tipX, tipY, arm, back - 45), b = onCircle(tipX, tipY, arm, back + 45);
  return `M${pt(...a)}L${pt(tipX, tipY)}L${pt(...b)}`;
}

/** Mirror a path about the vertical line x = 8. Handles the absolute commands this file writes (M L H C; V and Z pass through). */
export function mirrorX(d: string): string {
  return d.replace(/([MLCH])([^MLCHVZ]*)/g, (_, cmd: string, args: string) => {
    const n = args.trim().split(/[\s,]+/).map(Number);
    if (cmd === 'H') return `H${round(LINE_GRID - n[0])}`;
    const out: string[] = [];
    for (let i = 0; i < n.length; i += 2) out.push(pt(LINE_GRID - n[i], n[i + 1]));
    return cmd + out.join(' ');
  });
}

/** A regular star: outer and inner radius, one point up. */
function starPath(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) { const [x, y] = onCircle(cx, cy, i % 2 ? inner : outer, -90 + 36 * i); pts.push(pt(x, y)); }
  return `M${pts.join('L')}Z`;
}
/** A toothed wheel: `teeth` teeth, outer and root radius, tooth widths (degrees) at the top and the root, one tooth up. */
function gearPath(cx: number, cy: number, teeth: number, outer: number, root: number, top: number, base: number): string {
  const step = 360 / teeth, pts: string[] = [];
  for (let k = 0; k < teeth; k++) {
    const c = -90 + step * k;
    for (const [r, a] of [[root, c - base / 2], [outer, c - top / 2], [outer, c + top / 2], [root, c + base / 2]] as const) { const [x, y] = onCircle(cx, cy, r, a); pts.push(pt(x, y)); }
  }
  return `M${pts.join('L')}Z`;
}
/** A full circle starting at 12 o'clock and running clockwise (a dash offset then winds it from the top). */
const ringFromTop = (cx: number, cy: number, r: number): string => `M${pt(cx, cy - r)}A${r} ${r} 0 1 1 ${pt(cx, cy + r)}A${r} ${r} 0 1 1 ${pt(cx, cy - r)}`;
const circleD = (cx: number, cy: number, r: number): string => `M${pt(cx + r, cy)}A${r} ${r} 0 1 1 ${pt(cx - r, cy)}A${r} ${r} 0 1 1 ${pt(cx + r, cy)}`;

// ---- Reload and Stop (the signature morph): the sample's drawings ----
// In Stop the ring has straightened into one diagonal of the X and the head has unfolded into the other: same commands, so they interpolate.
// THE ONE CHANGE THE BRIEF ASKS FOR ("the arrow tip on the Reload icon looks slightly crooked at rest; redraw it so it sits true"): the sample's head is turned 5 degrees
// off the axes (its arms run to (9.33, 4.4) and (12.25, 1.94) from the tip at (12.02, 4.63)). Here the arms are exactly horizontal and vertical from the tip, and the arc's
// last control point (10.44, 2.74 in the sample) is moved to (10.44, 3.05) so the arc arrives at exactly 45 degrees, the way the head points. Nothing else of the ring moves.
const RELOAD_ARC = 'M13.17 8.91C12.74 11.34 10.69 13.14 8.23 13.25C5.77 13.35 3.57 11.74 2.93 9.36C2.29 6.98 3.39 4.48 5.58 3.34C7.76 2.21 10.44 3.05 12.02 4.63';
const RELOAD_HEAD = 'M9.33 4.63L12.02 4.63L12.02 1.94';
const STOP_A = 'M11.75 11.75C11.13 11.13 10.5 10.5 9.88 9.88C9.25 9.25 8.63 8.63 8 8C7.38 7.38 6.75 6.75 6.13 6.13C5.5 5.5 4.88 4.88 4.25 4.25';
const STOP_B = 'M4.25 11.75L8 8L11.75 4.25';

// ---- the sidebar toggle ----
const FRAME = 'M3.75 2.75h8.5a1.75 1.75 0 0 1 1.75 1.75v7a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 11.5v-7a1.75 1.75 0 0 1 1.75-1.75Z';

const PLAY_PATHS = ['M5.4 3.5L5.4 12.5L13.2 8L13.2 8Z', 'M13.2 8L13.2 8L5.4 12.5L5.4 3.5Z'];
const PAUSE_PATHS = ['M5.75 3.75L5.75 12.25L5.75 12.25L5.75 3.75Z', 'M10.25 3.75L10.25 12.25L10.25 12.25L10.25 3.75Z'];

export const LINE_ICONS = {
  back: { paths: [{ d: 'M13 8H3.25', role: 'shaft' }, { d: 'M7.25 4L3.25 8L7.25 12', role: 'head' }] },
  forward: { paths: [{ d: 'M3 8H12.75', role: 'shaft' }, { d: 'M8.75 4L12.75 8L8.75 12', role: 'head' }] },
  reload: { slot: 'reload', paths: [{ d: RELOAD_ARC, role: 'ring' }, { d: RELOAD_HEAD, role: 'head' }] },
  stop: { slot: 'reload', paths: [{ d: STOP_A, role: 'ring' }, { d: STOP_B, role: 'head' }] },
  home: { paths: [{ d: 'M2.25 7.25L8 2.5L13.75 7.25', role: 'roof' }, { d: 'M3.75 6.25v6.5c0 .55.45 1 1 1h6.5c.55 0 1-.45 1-1v-6.5', role: 'walls' }, { d: 'M6.5 13.75v-3.5h3v3.5', role: 'door' }] },
  history: { paths: [{ d: 'M2.5 8C2.5 10.62 4.35 12.88 6.93 13.39C9.5 13.91 12.08 12.53 13.08 10.1C14.09 7.68 13.24 4.88 11.06 3.43C8.87 1.97 5.97 2.26 4.11 4.11', role: 'ring' }, { d: 'M4.11 1.41V4.11H6.81', role: 'head' }, { d: 'M8 5.25V8L9.9 9.25', role: 'hands' }] },
  sidebar: { slot: 'sidebar', paths: [{ d: FRAME, role: 'frame' }, { d: 'M6.25 2.75V13.25', role: 'divider' }, { d: 'M10.75 6L9 8L10.75 10', role: 'chevron' }] },
  sidebarClosed: { slot: 'sidebar', paths: [{ d: FRAME, role: 'frame' }, { d: 'M4.5 2.75V13.25', role: 'divider' }, { d: 'M8.5 6L10.25 8L8.5 10', role: 'chevron' }] },
  star: { slot: 'star', paths: [{ d: 'M8 2.1L9.73 6.06L14.04 6.49L10.81 9.36L11.73 13.59L8 11.4L4.27 13.59L5.19 9.36L1.96 6.49L6.27 6.06Z', role: 'star', fill: true }] },
  starFilled: { slot: 'star', filled: true, paths: [{ d: 'M8 2.1L9.73 6.06L14.04 6.49L10.81 9.36L11.73 13.59L8 11.4L4.27 13.59L5.19 9.36L1.96 6.49L6.27 6.06Z', role: 'star', fill: true }] },
  downloads: { paths: [{ d: 'M8 2.25V10.25', role: 'arrow' }, { d: 'M4.75 7.25L8 10.5L11.25 7.25', role: 'arrow' }, { d: 'M2.5 10.75v1.75c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25v-1.75', role: 'tray' }] },
  new: { paths: [{ d: 'M8 8V3', role: 'arm' }, { d: 'M8 8V13', role: 'arm' }, { d: 'M8 8H3', role: 'arm' }, { d: 'M8 8H13', role: 'arm' }] },
  // 8.5 of the 16 grid (3.75 to 12.25), the approved player sample's cross: the media card's right pair weighs the same as its left, and the tab x
  // is a little closer to the Codicon x it replaced (which spans 10.6).
  x: { paths: [{ d: 'M4.5 4.5L11.5 11.5', role: 'stroke' }, { d: 'M11.5 4.5L4.5 11.5', role: 'stroke' }] },
  settings: { paths: [{ d: 'M12.55 6.8L14.35 7.22L14.35 8.78L12.55 9.2L12.06 10.37L13.04 11.94L11.94 13.04L10.37 12.06L9.2 12.55L8.78 14.35L7.22 14.35L6.8 12.55L5.63 12.06L4.06 13.04L2.96 11.94L3.94 10.37L3.45 9.2L1.65 8.78L1.65 7.22L3.45 6.8L3.94 5.63L2.96 4.06L4.06 2.96L5.63 3.94L6.8 3.45L7.22 1.65L8.78 1.65L9.2 3.45L10.37 3.94L11.94 2.96L13.04 4.06L12.06 5.63Z', role: 'gear' }, { d: 'M10.1 8a2.1 2.1 0 1 1-4.2 0a2.1 2.1 0 1 1 4.2 0', role: 'hub' }] },
  // The address suggestions' row glyphs (section O): the history clock (a full ring and two hands, not the rewind arrow of `history`), the open tab,
  // and the arrow that fills the address. The star in a row is `star`. The clock's parts carry the class names the list's own CSS winds and swings.
  clock: { split: true, paths: [{ d: ringFromTop(8, 8, 5.75), role: 'ring', cls: 'ring' }, { d: 'M8 8L8 4.75', role: 'hand', cls: 'hand-a' }, { d: 'M8 8L10.25 9.5', role: 'hand', cls: 'hand-b' }] },
  tab: { paths: [{ d: 'M4.25 3.5h7.5a1.75 1.75 0 0 1 1.75 1.75v5.5a1.75 1.75 0 0 1-1.75 1.75h-7.5a1.75 1.75 0 0 1-1.75-1.75v-5.5A1.75 1.75 0 0 1 4.25 3.5Z', role: 'frame' }, { d: 'M2.5 6.5H13.5', role: 'bar' }] },
  arrowUpRight: { paths: [{ d: 'M6 4.75H11.25V10', role: 'head' }, { d: 'M11.25 4.75L4.75 11.25', role: 'shaft' }] },
  bookmark: { paths: [{ d: 'M4 2.75h8a.75.75 0 0 1 .75.75V13.5L8 10.25L3.25 13.5V3.5A.75.75 0 0 1 4 2.75z', role: 'ribbon' }] },
  // The pin lies with its needle to the left, the way the Codicon it replaces does (the "Pin" glyph in the menus keeps that orientation).
  pin: { paths: [{ d: 'M13.25 6V10L9.65 9.6L7.5 11.75H6.35V4.25H7.5L9.65 6.4Z', role: 'head' }, { d: 'M6.35 8H2.5', role: 'needle' }] },
  // Beta 14: the sidebar row's "more extensions" button (the pinned extensions that do not fit its one line). A puzzle piece in one stroke, turned a quarter, the way the Lucide puzzle (ISC licence, as the lucide-react icons the browser already uses) is drawn,
  // scaled to the 16 grid: an upright piece with a knob on two sides read as a mug at 16-20 px in the first drafts.
  puzzle: { paths: [{ d: 'M10.26 2.927a0.667 0.667 0 0 0 1.12-0.316 1.667 1.667 0 1 1 2.009 2.01 0.667 0.667 0 0 0-0.316 1.12l1.122 1.121a1.609 1.609 0 0 1 0 2.276L13.073 10.26a0.667 0.667 0 0 1-1.12-0.316 1.667 1.667 0 1 0-2.009 2.01 0.667 0.667 0 0 1 0.316 1.12l-1.122 1.121a1.609 1.609 0 0 1-2.276 0L5.74 13.073a0.667 0.667 0 0 0-1.12 0.316 1.667 1.667 0 1 1-2.009-2.01 0.667 0.667 0 0 0 0.316-1.12l-1.122-1.121a1.609 1.609 0 0 1 0-2.276L2.927 5.74a0.667 0.667 0 0 1 1.12 0.316 1.667 1.667 0 1 0 2.009-2.01 0.667 0.667 0 0 1-0.316-1.12l1.122-1.121a1.609 1.609 0 0 1 2.276 0z', role: 'piece' }] },
  // Media (section N's now-playing card: the single-line set).
  play: { slot: 'playpause', paths: PLAY_PATHS.map(d => ({ d, role: 'shape' })) },
  pause: { slot: 'playpause', paths: PAUSE_PATHS.map(d => ({ d, role: 'shape' })) },
  prev: { paths: [{ d: 'M3.75 3.5V12.5', role: 'bar' }, { d: 'M12.25 3.9L6.25 8L12.25 12.1Z', role: 'shape' }] },
  next: { paths: [{ d: 'M12.25 3.5V12.5', role: 'bar' }, { d: 'M3.75 3.9L9.75 8L3.75 12.1Z', role: 'shape' }] },
  pip: { paths: [{ d: 'M3.5 2.75h9a1.75 1.75 0 0 1 1.75 1.75v7a1.75 1.75 0 0 1-1.75 1.75h-9A1.75 1.75 0 0 1 1.75 11.5v-7A1.75 1.75 0 0 1 3.5 2.75Z', role: 'frame' }, { d: 'M8.75 8.25h3v2.5h-3Z', role: 'inset' }] },
  // Beta 14 (screenshot): the optional camera button. A body with the viewfinder bump, and the lens.
  camera: { paths: [{ d: 'M3.75 4.5H5.4L6.4 3H9.6L10.6 4.5H12.25A1.75 1.75 0 0 1 14 6.25V11.25A1.75 1.75 0 0 1 12.25 13H3.75A1.75 1.75 0 0 1 2 11.25V6.25A1.75 1.75 0 0 1 3.75 4.5Z', role: 'body' }, { d: 'M8 6.6A2.2 2.2 0 1 1 8 11A2.2 2.2 0 1 1 8 6.6Z', role: 'lens' }] },
  goto: { paths: [{ d: 'M7.25 3.25H4.75a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8.75', role: 'frame' }, { d: 'M9.5 2.75h3.75v3.75', role: 'head' }, { d: 'M13.25 2.75L7.75 8.25', role: 'shaft' }] },
  volume: { slot: 'volume', paths: [{ d: 'M2.25 6.25h2.4L8 3.4v9.2L4.65 9.75h-2.4z', role: 'speaker' }, { d: 'M10.4 5.75a3.2 3.2 0 0 1 0 4.5', role: 'wave' }, { d: 'M12.2 4a5.7 5.7 0 0 1 0 8', role: 'wave' }] },
  muted: { slot: 'volume', paths: [{ d: 'M2.25 6.25h2.4L8 3.4v9.2L4.65 9.75h-2.4z', role: 'speaker' }, { d: 'M10.75 6.25l3.5 3.5', role: 'cross' }, { d: 'M14.25 6.25l-3.5 3.5', role: 'cross' }] },
} as const satisfies Record<string, { slot?: string; filled?: boolean; split?: boolean; paths: readonly LinePath[] }>;

export type LineIconName = keyof typeof LINE_ICONS;
/** `split`: the icon keeps its parts as separate paths at rest (only the clock, whose parts the suggestions list's own CSS addresses). Every other icon rests as ONE path. */
export interface LineIconDef { slot?: string; filled?: boolean; split?: boolean; paths: readonly LinePath[] }
export const lineIconNames = Object.keys(LINE_ICONS) as LineIconName[];
export const lineIconDef = (name: LineIconName): LineIconDef => LINE_ICONS[name];

/** What an icon is made of while it rests: ONE path holding every stroke (the page pays for two elements, svg and path, like any glyph: 24 icons of 3 to 5 elements
 * each were a third of a sidebar's whole DOM, and every forced style recalc in a Sidebar mode switch walks all of it). The parts go separate again only while the icon
 * animates (ui/lineIconPlay.ts builds them for the length of the motion). Two exceptions keep their own path: a part that takes a fill (the star), and a `split` icon.
 * Overlapping strokes of one path paint as one shape, which is what the separate paths looked like at rest. */
export interface RestPath { d: string; fill?: boolean; cls?: string }
/** FALSE (the decision of 14 Nov, under the team's exact-sample-parity rule): an icon at rest is drawn as the parts the approved sample draws, one `<path>` each (the star's fill and every stroke), so the
 * resting picture is the sample's, pixel for pixel (a QA rig: 0 differing rest pixels). Where two strokes of an icon meet or cross, separate paths blend their anti-aliased edges twice and one
 * path once; that is the whole difference. TRUE draws every stroke in one path instead: about 35 fewer elements in a Sidebar mode window (report 9d, 9e), at the price of 15 to 76 join pixels per icon. */
export const REST_AS_ONE_PATH = false;
const REST = new Map<LineIconName, readonly RestPath[]>();
export function restPaths(name: LineIconName): readonly RestPath[] {
  let rest = REST.get(name);
  if (!rest) {
    const def = lineIconDef(name);
    if (def.split || !REST_AS_ONE_PATH) rest = def.paths.map(p => ({ d: p.d, ...(p.cls ? { cls: p.cls } : {}), ...(p.fill ? { fill: true } : {}) }));
    else {
      const strokes = def.paths.filter(p => !p.fill).map(p => p.d).join('');
      rest = [...(strokes ? [{ d: strokes }] : []), ...def.paths.filter(p => p.fill).map(p => ({ d: p.d, fill: true }))];
    }
    REST.set(name, rest);
  }
  return rest;
}

/** The icons that share a slot morph into each other when the name changes (Reload/Stop, the sidebar toggle open/closed, the star
 * empty/saved, Play/Pause, the speaker loud/muted). Everything else is its own slot. */
export const slotOf = (name: LineIconName): string => (LINE_ICONS[name] as LineIconDef).slot ?? name;

/** The names the app's existing icon components use, for the places that map one to the other (ToolbarIcon). `new` is not here: the New tab "+" keeps
 * 13.10's filled Plus everywhere (reported 20 Nov: the line drawing looked thin and cheap, with a bright dot where its four strokes cross). */
export const lineNameFor: Record<string, LineIconName> = {
  back: 'back', forward: 'forward', reload: 'reload', home: 'home', history: 'history', sidebar: 'sidebar', sidebarClosed: 'sidebarClosed', star: 'star', starFilled: 'starFilled',
  downloads: 'downloads', bookmarks: 'bookmark', settings: 'settings', close: 'stop',
};

/** The command letters of a path, in order: two drawings can morph into each other when these match. */
export const commandShape = (d: string): string => d.replace(/[^MLCHVZAQSTmlchvzaqst]/g, '');
export const canMorph = (a: LineIconName, b: LineIconName): boolean => {
  const pa = LINE_ICONS[a].paths, pb = LINE_ICONS[b].paths;
  return pa.length === pb.length && pa.every((p, i) => commandShape(p.d) === commandShape(pb[i].d));
};

/** The end points of every segment of a path, in absolute coordinates. Reads absolute and relative commands (M L H V C S Q T A Z in
 * either case; arcs contribute their end point), so tests can check any drawing here, however it was written. */
export function pathPoints(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = []; let x = 0, y = 0, sx = 0, sy = 0;
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  for (const m of d.matchAll(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g)) {
    const cmd = m[1], upper = cmd.toUpperCase(), rel = cmd !== upper, n = (m[2].match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []).map(Number), size = arity[upper];
    if (upper === 'Z') { x = sx; y = sy; continue; }
    for (let i = 0; i + size <= n.length; i += size) {
      const a = n.slice(i, i + size), ox = rel ? x : 0, oy = rel ? y : 0;
      if (upper === 'H') x = a[0] + ox; else if (upper === 'V') y = a[0] + oy; else { x = a[size - 2] + ox; y = a[size - 1] + oy; }
      if (upper === 'M' && i === 0) { sx = x; sy = y; }
      out.push([x, y]);
    }
  }
  return out;
}
