import type { CSSProperties } from 'react';

const SPOKES = 8;

/** Page loading, as on iPhone and Mac: eight short dashes round a circle. Each one dims in steps after it lights, so the
 * brightest dash travels clockwise. With reduced motion it holds one still frame of the same gradient. */
export function Spinner({ size = 16, label, className = '' }: { size?: number; label?: string; className?: string }) {
  return <svg className={`ac-spinner ${className}`} width={size} height={size} viewBox="0 0 16 16" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {Array.from({ length: SPOKES }, (_, index) => <rect key={index} x="7.15" y="1" width="1.7" height="4.4" rx=".85" transform={`rotate(${index * 360 / SPOKES} 8 8)`}
      style={{ '--spoke': index, '--spokes': SPOKES } as CSSProperties} />)}
  </svg>;
}
