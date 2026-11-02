import { forwardRef, type CSSProperties } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

/** Status ticks (founder, 24 Oct): one crisp stroke check and its matching cross, never dot-matrix. A 1.5px stroke with
 * round caps and joins, optically centred, drawn on its own pixel grid at 12, 14 and 16 so the elbow and ends land on
 * quarter pixels (12px uses 1.25px). Other sizes scale the 16px drawing and keep a 1.5px stroke. Color is currentColor,
 * so a tick takes the ink or accent of the row it sits in. */
type Drawing = Record<12 | 14 | 16, { d: string; w: number }>;
const check: Drawing = {
  12: { d: 'M2.75 6.25 4.75 8.25 9.25 3.75', w: 1.25 },
  14: { d: 'M3.25 7 5.75 9.5 10.75 4.5', w: 1.5 },
  16: { d: 'M3.75 8.25 6.5 11 12.25 5.25', w: 1.5 },
};
const cross: Drawing = {
  12: { d: 'M3.75 3.75 8.25 8.25M8.25 3.75 3.75 8.25', w: 1.25 },
  14: { d: 'M4.25 4.25 9.75 9.75M9.75 4.25 4.25 9.75', w: 1.5 },
  16: { d: 'M4.75 4.75 11.25 11.25M11.25 4.75 4.75 11.25', w: 1.5 },
};

function mark(drawing: Drawing, name: string): LucideIcon {
  const Mark = forwardRef<SVGSVGElement, LucideProps>(({ size = 16, strokeWidth: _width, absoluteStrokeWidth: _absolute, className = '', ...rest }, ref) => {
    const pixels = Number.isFinite(Number(size)) ? Number(size) : 16, own = drawing[pixels as 12 | 14 | 16];
    const width = own ? own.w : pixels < 14 ? 1.25 : 1.5, labelled = rest['aria-label'] != null;
    // Inline paint so older `svg path` icon rules (fills, hairline strokes) can never restyle the tick.
    const paint: CSSProperties = { fill: 'none', stroke: 'currentColor', strokeWidth: width };
    return <svg aria-hidden={labelled ? undefined : true} role={labelled ? 'img' : undefined} {...rest} ref={ref} className={`acira-${name} ${className}`.trim()}
      width={pixels} height={pixels} viewBox={own ? `0 0 ${pixels} ${pixels}` : '0 0 16 16'} fill="none" stroke="currentColor">
      <path d={(own ?? drawing[16]).d} strokeLinecap="round" strokeLinejoin="round" vectorEffect={own ? undefined : 'non-scaling-stroke'} style={paint}/>
    </svg>;
  });
  Mark.displayName = name === 'check' ? 'CheckMark' : 'CrossMark';
  return Mark as LucideIcon;
}

export const CheckMark = mark(check, 'check');
export const CrossMark = mark(cross, 'cross');
