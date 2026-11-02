import type { CSSProperties } from 'react';
import pages from '../../desktop/internal-pages.json';

/** Acira glyph family: geometric marks on one 24-unit grid, drawn from the brand's grammar — straight segments
 * with square terminals, chamfered corners instead of soft curves, deliberate gaps, and the dot-matrix dot.
 * Monochrome (currentColor) only. Two optical sizes: `ui` for 16–20px (1.5px stroke at 16) and `hero` for
 * 32–48px (bold brand marks, like the reference glyphs). Toolbar navigation keeps its
 * familiar metaphors elsewhere; these are for brand moments, Settings sections, onboarding, empty states and toasts. */
type Shape = { s: string } | { f: string } | { d: [number, number] };
const stroke = (s: string): Shape => ({ s }), fill = (f: string): Shape => ({ f }), dot = (x: number, y: number): Shape => ({ d: [x, y] });
// Chamfered square ("octagon") from x0,y0 to x1,y1 with corner cut c.
const oct = (x0: number, y0: number, x1: number, y1: number, c: number) => `M${x0 + c} ${y0}H${x1 - c}L${x1} ${y0 + c}V${y1 - c}L${x1 - c} ${y1}H${x0 + c}L${x0} ${y1 - c}V${y0 + c}Z`;

const glyphs = {
  // People: chamfered head, shoulders as a cut trapezoid.
  profile: [stroke(oct(8, 3.5, 16, 11.5, 2.4)), stroke('M4.5 20.5V18.5L8 15H16L19.5 18.5V20.5')],
  // Appearance: chamfered frame, the dark half solid.
  appearance: [stroke(oct(4, 4, 20, 20, 4)), fill('M12 4H8L4 8V16L8 20H12Z')],
  // Search: chamfered lens, detached handle.
  search: [stroke(oct(3.5, 3.5, 15.5, 15.5, 3.5)), stroke('M17 17L20.5 20.5')],
  // Import: a dotted lead-in, shaft and head into an open tray.
  import: [dot(12, 3.5), stroke('M12 7V14.5'), stroke('M8 11L12 15L16 11'), stroke('M4 15.5V20H9.5'), stroke('M14.5 20H20V15.5')],
  // Export: the same tray, arrow leaving it.
  export: [stroke('M12 15V6.5'), stroke('M8 10.5L12 6.5L16 10.5'), dot(12, 3), stroke('M4 15.5V20H9.5'), stroke('M14.5 20H20V15.5')],
  // Import & export: two opposed arrows.
  transfer: [stroke('M8 4.5V17'), stroke('M4.5 13.5L8 17L11.5 13.5'), stroke('M16 19.5V7'), stroke('M12.5 10.5L16 7L19.5 10.5')],
  // Privacy: faceted shield with a keyhole.
  privacy: [stroke('M12 3L19.5 5.5V12.5L12 21L4.5 12.5V5.5Z'), dot(12, 9.5), stroke('M12 12.5V15')],
  // Default browser: window with a status strip and a check.
  defaultBrowser: [stroke('M3.5 5H20.5V19H3.5Z'), stroke('M3.5 9H20.5'), dot(6.5, 7), dot(9, 7), stroke('M9 14L11 16L15.5 11.5')],
  check: [stroke('M4.5 12.5L9.5 17.5L19.5 7')],
  close: [stroke('M6 6L18 18'), stroke('M18 6L6 18')],
  // Spectrum: a radiant star — long cardinal rays, short diagonals, the matrix dot at its centre.
  spectrum: [stroke('M12 2.5V8'), stroke('M12 16V21.5'), stroke('M2.5 12H8'), stroke('M16 12H21.5'), stroke('M5.8 5.8L8.3 8.3'), stroke('M15.7 15.7L18.2 18.2'), stroke('M18.2 5.8L15.7 8.3'), stroke('M8.3 15.7L5.8 18.2'), dot(12, 12)],
  // Tabs: a frame with a raised tab notch.
  tabs: [stroke('M3.5 20V4.5H10.5V8H20.5V20Z'), stroke('M10.5 8H3.5')],
  // Accessibility: figure built from a dot and three bars.
  accessibility: [dot(12, 4.5), stroke('M4.5 9H19.5'), stroke('M12 9V14'), stroke('M12 14L8 20.5'), stroke('M12 14L16 20.5')],
  // About: chamfered frame with an i.
  // (about, history, bookmark, download, extensions, passwords, webApps, settings, rewind and tabSets are Acira's page glyphs, in ui/internalPages.json: the Close Acira? card draws the same shapes.)
  // History: chamfered dial, hands at ten past.
  // Bookmarks: notched flag.
  // Downloads: shaft into a base bar.
  // Error / warning: faceted triangle with a mark.
  warning: [stroke('M12 3.5L21 19.5H3Z'), stroke('M12 9.5V14'), dot(12, 16.6)],
  error: [stroke(oct(3.5, 3.5, 20.5, 20.5, 5)), stroke('M9 9L15 15'), stroke('M15 9L9 15')],
  // Settings sections that used filled fallback icons (round 2): one family, one weight.
  // Extensions: a chamfered puzzle piece, knobs on the top and the right.
  // Passwords: a key — chamfered bow with the matrix dot, a shaft and two teeth.
  // Shortcuts: a chamfered keyboard, a row of keys as dots and the space bar.
  shortcuts: [stroke(oct(2.5, 6, 21.5, 18, 2.5)), dot(8, 10.2), dot(12, 10.2), dot(16, 10.2), stroke('M8 14.5H16')],
  // Web apps: three chamfered tiles and a plus in the fourth place.
  // Connection: a chamfered globe — equator and two faceted meridians meeting its flat top and bottom.
  connection: [stroke(oct(3.5, 3.5, 20.5, 20.5, 5)), stroke('M3.5 12H20.5'), stroke('M10.2 3.5L8.4 7.8V16.2L10.2 20.5'), stroke('M13.8 3.5L15.6 7.8V16.2L13.8 20.5')],
  // Acira's own pages (round 2, founder: "informative icons", only the New tab keeps the logo).
  // Settings: a six-tooth cog on straight flanks, a chamfered hub.
  // Rewind: the history dial opened, an arrowhead turning it back, one hand pointing back.
  // Tab sets: two tabs stacked, the front one notched like Tabs.
  ...(pages.glyphs as { [name in keyof typeof pages.glyphs]: Shape[] }),
  // Spelling: lines of text and a check.
  spelling: [stroke('M4 6.5H15'), stroke('M4 11.5H11'), stroke('M12 17L14.5 19.5L20 14')],
  // Empty state: a 3×3 matrix with the centre cell missing.
  empty: [dot(6, 6), dot(12, 6), dot(18, 6), dot(6, 12), dot(18, 12), dot(6, 18), dot(12, 18), dot(18, 18)],
} satisfies Record<string, Shape[]>;

export type AciraGlyphName = keyof typeof glyphs;
export const aciraGlyphNames = Object.keys(glyphs) as AciraGlyphName[];

/** One glyph. `size` in px; the optical weight follows it (ui ≤ 24px, hero above) unless `optical` is given.
 * Pass `label` when the glyph carries meaning on its own; otherwise it is decorative and hidden from assistive tech. */
export function AciraGlyph({name,size=16,optical,label,className='',style}:{name:AciraGlyphName;size?:number;optical?:'ui'|'hero';label?:string;className?:string;style?:CSSProperties}){
 const hero=(optical||(size>24?'hero':'ui'))==='hero';
 // Stroke in grid units: 1.5px at 16px for UI; hero glyphs are bold brand marks, 4px at 48px.
 const weight=hero?2:2.25,radius=hero?1.65:1.55;
 return <svg className={`acira-glyph ${className}`} data-glyph={name} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit={10} shapeRendering="geometricPrecision" style={style} {...(label?{role:'img','aria-label':label}:{'aria-hidden':true,focusable:false})}>
  {glyphs[name].map((shape,index)=>'s' in shape?<path key={index} d={shape.s}/>:'f' in shape?<path key={index} d={shape.f} fill="currentColor" stroke="none"/>:<circle key={index} cx={shape.d[0]} cy={shape.d[1]} r={radius} fill="currentColor" stroke="none"/>)}
 </svg>;
}
