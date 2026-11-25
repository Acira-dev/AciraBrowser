import { memo, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { LINE_STROKE, lineIconDef, restPaths, slotOf, type LineIconName } from '../ui/lineIconSet';
import { playMorph } from '../ui/lineIconPlay';
import './LineIcon.css';

/** Beta 14 section G: one icon of the single-line set, drawn like the website's line above the hero title.
 *
 * - At rest it is an `<svg>` with ONE `<path>` (every stroke of the drawing in it): the same two elements as any glyph, so a screen full of icons costs the page what it
 *   always did. A `split` icon (the suggestions list's clock) keeps its parts, each with `pathLength=1`, because its owner's CSS winds them with dash offsets. The parts exist separately only while the icon is moving (ui/lineIconPlay.ts adds them for the length of the motion and takes them away).
 * - Press and hover behaviours need no wiring: the page starts one delegated listener set (ui/lineIconPlay.ts), and any icon inside a button, link or `role=button`
 *   host plays what its name has (the inventory is in ui/lineMotion.ts).
 * - Changing `name` within a slot (reload > stop, sidebar > sidebarClosed, star > starFilled, play > pause) MORPHS the same element in the commit that changed it:
 *   the shape interpolates, nothing cross-fades. Keep the element mounted across the change.
 * - Speed follows the Fast / Premium setting and Off / reduced motion plays nothing: the state swaps.
 * - It is a drawing, not a font glyph: `currentColor`, no fill (except a saved star), `aria-hidden`; the button carries the label.
 *
 * `size` is the box in px; the stroke stays 1.3 on the 16 grid at any size. */
export const LineIcon = memo(function LineIcon({ name, size = 18, className = '', style }: { name: LineIconName; size?: number; className?: string; style?: CSSProperties }) {
  const ref = useRef<SVGSVGElement>(null), previous = useRef(name);
  useLayoutEffect(() => {
    const was = previous.current; previous.current = name;
    if (was !== name && ref.current && slotOf(was) === slotOf(name)) playMorph(ref.current, was, name);
  }, [name]);
  const def = lineIconDef(name), filled = def.filled ? 1 : 0;
  return <svg ref={ref} className={`li-icon ${className}`.trim()} data-li={name} aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 16 16"
    fill="none" stroke="currentColor" strokeWidth={LINE_STROKE} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {restPaths(name).map((path, i) => <path key={i} className={path.cls ?? 'li-rest'} d={path.d} pathLength={def.split ? 1 : undefined} fill={path.fill ? 'currentColor' : undefined} fillOpacity={path.fill ? filled : undefined}/>)}
  </svg>;
});

export type { LineIconName };
