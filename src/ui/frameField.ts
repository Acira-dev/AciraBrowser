import { fromOklch, mix, rgb, toOklch } from './colorMath';
import { frameColours, frameMaterialOf, isOwnFinish } from '../runtime/ownColours';
import type { FrameMaterial, Settings } from '../runtime/types';

/**
 * Your colours (Beta 14.1): what an own colour becomes on the frame, pure so a test holds every rule.
 *
 * - FIXED LIGHTNESS. A colour the person picks keeps its hue and part of its colourfulness; its lightness is Acira's (OKLCH .27 in dark, .90 in
 *   light, the deep and pale finishes' own range). So one ink reads on every colour anyone can pick, and a gradient's stops all take the same ink.
 * - ONE FIELD. One colour is one flat tone. Two to four colours run CORNER TO CORNER on a diagonal since 14.3 (`diagTokens` below: from the top
 *   corner on the sidebar's side to the opposite foot corner, the colour in use first), on the frame's one layer; 14.1 and 14.2 ran them from the
 *   window's top to its bottom. The older variables stay for whatever still reads a top-to-bottom veil (styles/own-colours.css says where):
 *   `--frame-top-rgb`, `--frame-bottom-rgb` and `--frame-mid-veil`; `--frame-solid` is the field opaque.
 * - GLOSSY is the same field with a fixed shine from the top baked into its stops (and a 1 px rim at the window's top edge): still one field, so every
 *   piece a layout switch paints carries it too. MATTE is the veil at full strength (ui/semanticColors.ts).
 * - Nothing here moves: no animation, nothing on a timer.
 */
export const OWN_DARK_L = .27, OWN_LIGHT_L = .90, OWN_DARK_C = .10, OWN_LIGHT_C = .08;
/** The frame colour for a colour the person chose (its hue, some of its colourfulness, Acira's lightness). */
export function frameStop(hex: string, dark: boolean): string {
  const [, C, h] = toOklch(hex);
  return dark ? fromOklch(OWN_DARK_L, Math.min(C * .6, OWN_DARK_C), h) : fromOklch(OWN_LIGHT_L, Math.min(C * .5, OWN_LIGHT_C), h);
}
const triple = (hex: string) => rgb(hex).join(' ');
/** A stop of the field: its colour and where it stands (0 top, 1 bottom). */
interface Stop { color: string; at: number }
/** 14.3, C (the team's pick, 22 Nov 20:46: "b tonight then c in 14.3"): ONE field across the window on a DIAGONAL, so a layout with no sidebar
 *  (hidden, tabs on top) shows every colour too. The direction is CSS's `to bottom right` (sidebar on the left; on the right its mirror, `to bottom
 *  left`, set by styles/own-colours.css as `--frame-dir`): its 50 % line runs through the window's other two corners, so a point's place on it is
 *  x / 2W + y / 2H. The band along the top runs 0 to .5 along x and the sidebar's column 0 to .5 down y: the colours stand within that range, and the
 *  same places hold as equal a share of the frame you SEE as one field can in every layout at once, so the field never changes when the sidebar hides
 *  or shows. Fitted on the real pictures (a QA rig, dark and light, sidebar 168 / 240 / 312 left and right, hidden, tabs on top; the worst
 *  colour of the worst layout within 8 points of even: the band along the top is part covered by the toolbar's controls and the address field). No two closer than 0.05: a blend is never a hard step. Beyond the last place the
 *  last colour runs to the far corner (under the page). */
export const DIAG_PLACES: Record<2 | 3 | 4, number[]> = { 2: [.0704, .52], 3: [.1086, .3, .45], 4: [.1091, .22, .3684, .47] };
export const diagPlaces = (n: number): number[] => n <= 1 ? [0] : n <= 4 ? DIAG_PLACES[n as 2 | 3 | 4] : Array.from({ length: n }, (_, i) => .5 * i / (n - 1));
/** A point's place on the field (0 the window's top-left corner, 1 its foot-right), sidebar on the left; mirror x for the right. */
export const diagPlace = (x: number, y: number, w: number, h: number): number => x / (2 * w) + y / (2 * h);
/** 14.2's places (B, top to bottom), kept for the one-colour field and the record of what B measured. */
export const EVEN_PLACES: Record<2 | 3 | 4, number[]> = { 2: [.1349, .7308], 3: [.0105, .4262, .8357], 4: [.0009, .2332, .6341, .8288] };
/** One point of a blend in OKLCH, the shorter way round the hue wheel. Measured 22 Nov: between far hues (indigo and amber) an sRGB blend goes grey
 *  in the middle (colourfulness .028 against .10 and .058 at its ends); OKLCH keeps .079 and passes through the hues between, as his sample does
 *  (indigo, purple, magenta, orange). The lightness is the ends' own (Acira's fixed one), so one ink still reads on every point. */
export function lchBlend(a: string, b: string, u: number): string {
  const [La, Ca, ha] = toOklch(a), [Lb, Cb, hb] = toOklch(b);
  const h1 = Ca < .02 ? hb : ha, h2 = Cb < .02 ? ha : hb;
  let dh = h2 - h1; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
  return fromOklch(La + (Lb - La) * u, Ca + (Cb - Ca) * u, h1 + dh * u);
}
/** The colours along the diagonal: the frame colours at their places, blended in OKLCH (sampled eight times between two colours), the first and the
 *  last flat beyond their places. */
export function diagStops(colours: string[], dark: boolean): Stop[] {
  const tones = colours.map(c => frameStop(c, dark)), places = diagPlaces(tones.length), steps = 8, out: Stop[] = [];
  for (let i = 0; i < tones.length - 1; i++) for (let k = 0; k < steps; k++) out.push({ color: lchBlend(tones[i], tones[i + 1], k / steps), at: +(places[i] + (places[i + 1] - places[i]) * k / steps).toFixed(4) });
  out.push({ color: tones[tones.length - 1], at: places[places.length - 1] });
  if (out[0].at > 0) out.unshift({ color: tones[0], at: 0 });
  if (out[out.length - 1].at < 1) out.push({ color: tones[tones.length - 1], at: 1 });
  return out;
}
/** The field's colour at a place on the diagonal (a linear blend between its stops, as the browser paints it). */
export function diagColourAt(stops: Stop[], at: number): string {
  for (let i = 1; i < stops.length; i++) if (at <= stops[i].at) { const a = stops[i - 1], b = stops[i], k = (at - a.at) / ((b.at - a.at) || 1); return mix(b.color, a.color, k); }
  return stops[stops.length - 1].color;
}
/** GLOSSY's shine, as 14.1: white over the field, 15 % at the top edge, 7 % at 44 px (5 % of the height), 2 % at 38 %, none from 60 % (light 78 / 42 /
 *  12 / 0), and the 1 px rim (22 %, light 95 %). Over a diagonal field it is its own layer from the top: white at that strength over any colour is
 *  exactly 14.1's mix of white into that colour. */
const SHINE_AT = [0, .05, .38, .6];
const shineLift = (dark: boolean) => dark ? [.15, .07, .02, 0] : [.78, .42, .12, 0];
export function shineLayer(dark: boolean, scale = '1'): string {
  const lift = shineLift(dark), rim = dark ? .22 : .95, a = (v: number) => scale === '1' ? `${v}` : `calc(${v} * ${scale})`;
  return `linear-gradient(180deg, rgb(255 255 255 / ${a(rim)}) 0, rgb(255 255 255 / ${a(rim)}) 1px, ${SHINE_AT.map((at, i) => `rgb(255 255 255 / ${a(lift[i])}) ${i === 0 ? '1px' : `${at * 100}%`}`).join(', ')})`;
}
/** The one-colour field (flat, or Glossy's shine baked in), top to bottom: 14.1's exactly. */
export function fieldStops(colours: string[], material: FrameMaterial, dark: boolean): Stop[] {
  const tones = colours.map(c => frameStop(c, dark));
  if (!tones.length) return [];
  const base: Stop[] = tones.length === 1 ? [{ color: tones[0], at: 0 }, { color: tones[0], at: 1 }] : diagStops(colours, dark);
  if (material !== 'glossy' || tones.length > 1) return base;
  const lift = shineLift(dark);
  const liftAt = (p: number) => { for (let i = 1; i < SHINE_AT.length; i++) if (p <= SHINE_AT[i]) return lift[i - 1] + (lift[i] - lift[i - 1]) * (p - SHINE_AT[i - 1]) / (SHINE_AT[i] - SHINE_AT[i - 1]); return 0; };
  return [...SHINE_AT.map(p => ({ color: mix('#ffffff', tones[0], liftAt(p)), at: p })), { color: tones[0], at: 1 }];
}
/** The CSS variables for the frame's field, or none when an own colour paints the frame flat (one colour on Glass or Matte: the frame rules
 *  already paint the finish's own colour). `--frame-rim` is Glossy's 1 px top edge, a stop pair at the head of the list. */
export function frameFieldTokens(s: Pick<Settings, 'colorPreset' | 'browserTint' | 'frameGradient' | 'frameMaterial' | 'sidebarColor'>, dark: boolean): Record<string, string> {
  if (!isOwnFinish(s) || s.sidebarColor) return {};
  const colours = frameColours(s), material = frameMaterialOf(s);
  if (colours.length < 2 && material !== 'glossy') return {};
  if (colours.length >= 2) return diagTokens(colours, material, dark);
  const stops = fieldStops(colours, material, dark), first = stops[0], last = stops[stops.length - 1], mid = stops.slice(1, -1);
  const pct = (at: number) => `${+(at * 100).toFixed(2)}%`;
  const veilAt = (at: number) => `calc(var(--chrome-veil-top) + (var(--chrome-veil-bottom) - var(--chrome-veil-top)) * ${+at.toFixed(4)})`;
  const rim = material === 'glossy' ? mix('#ffffff', first.color, dark ? .22 : .95) : null;
  const midVeil = [
    ...(rim ? [`rgb(${triple(rim)} / var(--chrome-veil-top)) 1px`, `rgb(${triple(first.color)} / var(--chrome-veil-top)) 1px`] : []),
    ...mid.map(stop => `rgb(${triple(stop.color)} / ${veilAt(stop.at)}) ${pct(stop.at)}`),
  ];
  const solid = [
    ...(rim ? [`${rim} 0`, `${rim} 1px`, `${first.color} 1px`] : [`${first.color} 0`]),
    ...mid.map(stop => `${stop.color} ${pct(stop.at)}`),
    `${last.color} 100%`,
  ];
  // THE LIVE FLOAT (the sidebar revealed over the live page, styles/sidebar-overlay.css): the same field, every stop (the rim, the shine, the middle
  // colours), at the float's own strength over its glass: .76 in light; in dark .82 at the top to .73 at the foot, the float's own gradient. Found on
  // real frames (21 Nov): a fill from the first colour to the last left Glossy's shine out, so the float's top stood darker than the toolbar beside it.
  const floatAt = (at: number) => dark ? +(.82 + (.73 - .82) * at).toFixed(4) : .76;
  const float = [
    ...(rim ? [`rgb(${triple(rim)} / ${floatAt(0)}) 0`, `rgb(${triple(rim)} / ${floatAt(0)}) 1px`, `rgb(${triple(first.color)} / ${floatAt(0)}) 1px`] : [`rgb(${triple(first.color)} / ${floatAt(0)}) 0`]),
    ...mid.map(stop => `rgb(${triple(stop.color)} / ${floatAt(stop.at)}) ${pct(stop.at)}`),
    `rgb(${triple(last.color)} / ${floatAt(1)}) 100%`,
  ];
  return {
    '--frame-top-rgb': triple(rim ?? first.color),
    '--frame-bottom-rgb': triple(last.color),
    '--frame-mid-veil': midVeil.map(stop => `${stop},`).join(''),
    '--frame-solid': `linear-gradient(180deg, ${solid.join(', ')})`,
    '--frame-float': `linear-gradient(180deg, ${float.join(', ')})`,
    /* the field's colour where the window's caption buttons sit (Windows without the window material paints them flat): the top of the field, under the rim */
    '--frame-caption': first.color,
  };
}

/** C's variables (14.3): the diagonal field, painted ONCE on the window's own layer, which never moves. styles/own-colours.css says where:
 *  - `--frame-solid` (Matte, Glossy, an inactive or transparency-off acrylic) and `--frame-veil` (Glass: ONE window-sized veil at the veil's mean
 *    strength, in place of today's two side-by-side layers, whose separate boxes would not line up on a diagonal) paint `.app`; Glossy's shine is
 *    their first layer, from the top.
 *  - In a layout switch nothing that slides carries the field (the sidebar's own veil, the band and strip pieces and the cut-out of the window's old
 *    picture are off): a diagonal is not the same under a sideways slide, as 14.1's top-to-bottom field was, so each piece would show a step.
 *  - `--frame-float` is the live float's fill: the window's field at the float's strength, placed at the window's size from the float's own corner
 *    (`--frame-anchor`), so it lines up with the frame beside it.
 *  - `--frame-top-rgb` / `--frame-mid-veil` / `--frame-bottom-rgb` stay for anything that still reads the top-to-bottom veil: the first colour, the
 *    last, nothing between. */
function diagTokens(colours: string[], material: FrameMaterial, dark: boolean): Record<string, string> {
  const stops = diagStops(colours, dark), first = stops[0].color, last = stops[stops.length - 1].color, glossy = material === 'glossy';
  const pct = (at: number) => `${+(at * 100).toFixed(2)}%`, dir = 'var(--frame-dir, to bottom right)';
  const field = (alpha?: string) => `linear-gradient(${dir}, ${stops.map(st => `${alpha ? `rgb(${triple(st.color)} / ${alpha})` : st.color} ${pct(st.at)}`).join(', ')})`;
  const veilA = 'calc((var(--chrome-veil-top) + var(--chrome-veil-bottom)) / 2)', floatA = dark ? '.775' : '.76';
  const placed = (layer: string) => `${layer} var(--frame-anchor, left 0 top 0) / 100vw 100vh no-repeat`;
  return {
    '--frame-solid': `${glossy ? `${shineLayer(dark)}, ` : ''}${field()}`,
    '--frame-veil': `${glossy ? `${shineLayer(dark, veilA)}, ` : ''}${field(veilA)}`,
    '--frame-float': `${glossy ? `${placed(shineLayer(dark, floatA))}, ` : ''}${placed(field(floatA))}`,
    '--frame-top-rgb': triple(first), '--frame-bottom-rgb': triple(last), '--frame-mid-veil': '',
    /* the low corner piece beside the float's foot (sidebar-overlay.css): the field's colour there (x about 240 of a 1272 window, at the foot) */
    '--frame-corner-low-rgb': triple(diagColourAt(stops, diagPlace(240, 1, 1272, 1))),
    /* the caption buttons sit at the top right (Windows, without the window material: a flat box of 138 pt): their colour is the field's where the box
       meets the field, at its left edge (t about .45 with the sidebar on the left; seen on the Mac stand-in, 23 Nov: the corner's own colour, t .5,
       stood 10 to 19 levels off the field beside the box); on the right side the mirror puts the first colour there */
    '--frame-caption': diagColourAt(stops, .45), '--frame-caption-right': first,
  };
}

/** The colour of a point of the picker's light field: across is the hue (0 to 360), down is the light (1 the top, pale; 0 the foot, deep). The
 *  colourfulness is fullest in the middle of the light. */
export function fieldColour(hue: number, light: number): string {
  const l = Math.min(1, Math.max(0, light)), L = .3 + .62 * l, C = .17 * Math.pow(Math.sin(Math.PI * Math.min(.98, Math.max(.02, l))), .7);
  return fromOklch(L, C, (((hue % 360) + 360) % 360) * Math.PI / 180);
}
/** Where a colour sits in the light field (its hue and its light), the inverse of fieldColour within what the field can show. */
export function fieldPoint(hex: string): { hue: number; light: number } {
  const [L, , h] = toOklch(hex);
  return { hue: Math.round((((h * 180 / Math.PI) % 360) + 360) % 360), light: Math.min(1, Math.max(0, (L - .3) / .62)) };
}
/** A colour in words, for the picker and for screen readers: one of fifteen names (i18n keys `owncolours.hue.*`) and its light in whole percent. */
export const HUE_NAMES = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'purple', 'magenta', 'pink'] as const;
export type HueName = typeof HUE_NAMES[number] | 'grey';
const HUE_EDGES: readonly [number, HueName][] = [[18, 'pink'], [42, 'red'], [62, 'orange'], [82, 'amber'], [108, 'yellow'], [130, 'lime'], [165, 'green'], [190, 'teal'], [222, 'cyan'], [258, 'blue'], [280, 'indigo'], [300, 'violet'], [320, 'purple'], [345, 'magenta'], [360, 'pink']];
export function colourWords(hex: string): { hue: HueName; light: number } {
  const [L, C, h] = toOklch(hex), deg = (((h * 180 / Math.PI) % 360) + 360) % 360;
  return { hue: C < .035 ? 'grey' : (HUE_EDGES.find(([edge]) => deg < edge) ?? HUE_EDGES[0])[1], light: Math.round(Math.min(1, Math.max(0, L)) * 100) };
}

/** The still glow (14.1): Ambient's own light, fed the person's colours instead of the page's. A chosen colour glows at Ambient's full share: it is
 *  lifted toward white until its luma reaches 150 (ui/ambientColours.ts gives a page's dark colour little light; a colour picked on purpose should
 *  not fade), its hue kept. Rows as main sends them (desktop/ambient-edge.cjs): down the sidebar's side, along the top, the far side, the bottom. */
const lumaOf = (c: number[]) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
export function glowColour(hex: string): [number, number, number] {
  const c = rgb(hex); let k = 0, v = c;
  while (lumaOf(v) < 150 && k < 1) { k = Math.min(1, k + .02); v = c.map(x => Math.round(x + (255 - x) * k)); }
  return [v[0], v[1], v[2]];
}
export function fixedGlowSample(colours: string[], side: 'left' | 'right'): { id: string; side: 'left' | 'right'; l: [number, number, number][]; t: [number, number, number][]; r: [number, number, number][]; b: [number, number, number][] } {
  const glow = colours.map(c => rgb(toHex(glowColour(c))));
  if (colours.length < 2) { const c = glow[0] as [number, number, number]; const flat = (n: number) => Array.from({ length: n }, () => [...c] as [number, number, number]); return { id: 'own-glow', side, l: flat(16), t: flat(24), r: flat(16), b: flat(24) }; }
  // 14.3: the light along each edge is the diagonal field's own colour there (ui/frameField.ts diagPlace, a 16:10 window), the colours at the field's
  // places, blended as the field is. Rows as main sends them: down the sidebar's side (l) and the far side (r) top to bottom; along the top (t) and
  // the bottom (b) from the window's left to its right.
  const places = diagPlaces(glow.length);
  const at = (p: number): [number, number, number] => {
    if (p <= places[0]) return [...glow[0]] as [number, number, number];
    for (let i = 1; i < places.length; i++) if (p <= places[i]) { const k = (p - places[i - 1]) / (places[i] - places[i - 1]); return rgb(lchBlend(toHex(glow[i - 1]), toHex(glow[i]), k)) as [number, number, number]; }
    return [...glow[glow.length - 1]] as [number, number, number];
  };
  // the sidebar's side is the field's first column whichever side it stands on; along the top and the bottom the right side's field is the mirror
  const W = 1.6, H = 1, mirror = (x: number) => side === 'left' ? x : W - x, row = (n: number, f: (k: number) => number) => Array.from({ length: n }, (_, i) => at(f(n === 1 ? 0 : i / (n - 1))));
  return { id: 'own-glow', side, l: row(16, k => diagPlace(0, k * H, W, H)), t: row(24, k => diagPlace(mirror(k * W), 0, W, H)), r: row(16, k => diagPlace(W, k * H, W, H)), b: row(24, k => diagPlace(mirror(k * W), H, W, H)) };
}
const toHex = (c: number[]) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
