import { useRef, type MouseEvent } from 'react';
import { shake } from './winter/controller';

/**
 * The tree: Noël's button in the sidebar's bottom row. A press shakes the snow globe (a fuller fall for about 14 s); with no snowfall, or while snow cannot fall (Reduce motion, a low
 * battery), only the star glints. Right-click opens its menu (`onMenu`). The star is warm gold while the theme is on.
 */
/** The star's glint, what a press does when snow cannot fall: also what the menu's Shake the globe does then (Reduce motion, a low battery). */
export function glint(el: Element | null): void { if (!el) return; el.removeAttribute('data-glint'); void (el as HTMLElement).offsetWidth; el.setAttribute('data-glint', ''); window.setTimeout(() => el.removeAttribute('data-glint'), 900); }
export function glintTrees(): void { document.querySelectorAll('.noel-tree').forEach(glint); }
export function NoelTree({ label, onMenu, snowOff = false }: { label: string; onMenu: (event: MouseEvent<HTMLButtonElement>) => void; /** Snowfall is off: a press opens the choices instead of shaking */ snowOff?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const press = (event: MouseEvent<HTMLButtonElement>) => { if (snowOff) { onMenu(event); return; } if (!shake()) { const el = ref.current; if (el) { el.removeAttribute('data-glint'); void el.offsetWidth; el.setAttribute('data-glint', ''); window.setTimeout(() => el.removeAttribute('data-glint'), 900); } } };
  return <button type="button" className="sb-foot-icon noel-tree" ref={ref} aria-label={label} title={label} onClick={press} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onMenu(event); }}>
    <svg className="noel-tree-icon" viewBox="0 0 24 24" aria-hidden="true">
      <defs><linearGradient id="noel-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff4cf"/><stop offset=".4" stopColor="#f6d27e"/><stop offset=".75" stopColor="#d9a447"/><stop offset="1" stopColor="#b07a2c"/></linearGradient><radialGradient id="noel-starglow"><stop offset="0" stopColor="rgba(255,240,200,.75)"/><stop offset="1" stopColor="rgba(255,240,200,0)"/></radialGradient></defs>
      <circle className="glowdot" cx="12" cy="3.3" r="4.8" fill="url(#noel-starglow)"/>
      <path className="tr" d="M12 6.4c1.1 2 2.6 3.6 4.4 4.7-.9.3-1.8.4-2.7.3 1.4 2.2 3.3 3.9 5.4 5-5 1.3-9.2 1.3-14.2 0 2.1-1.1 4-2.8 5.4-5-.9.1-1.8 0-2.7-.3 1.8-1.1 3.3-2.7 4.4-4.7z"/>
      <path className="tr" d="M12 17.6v3.4"/>
      <path className="star" d="M12 .4c.3 1.75 1.15 2.6 2.9 2.9-1.75.3-2.6 1.15-2.9 2.9-.3-1.75-1.15-2.6-2.9-2.9 1.75-.3 2.6-1.15 2.9-2.9z"/>
    </svg>
  </button>;
}
