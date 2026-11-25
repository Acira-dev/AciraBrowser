import { useEffect, useLayoutEffect, useRef, type CSSProperties, type DragEvent as ReactDragEvent, type ReactNode, type RefObject } from 'react';
import { closeMorph, holdFan, holdMotion, openMorph, settleFavorites, settleOpen } from './favoritesStack';

/** The stack tile grown into a panel over the Favorites (Beta 14, L4): every Favorite in the grid's own tiles, scrolling inside.
 *
 *  It stays open until the person folds it (E6 of the team's notes, 17 Nov: "they close only when the person collapses them"): the fold pill below it (outside the panel), Esc while the focus is
 *  inside the panel (this document only hears keys while the interface has the keyboard; when the person is in the web page the Esc belongs to the page), dragging a Favorite out of it (the
 *  panel folds so the visible grid is there to drop on), or no folded Favorites left (AciraSidebar.tsx). A click on a tab, the page or the toolbar, the interface losing the keyboard, and opening a
 *  Favorite or the add tile from it leave it open. Whether it is open lives in favoritesPanelState.ts. The animation is
 *  favoritesStack.ts (open and close are the one front, run backwards); a plain quick fade with Reduce motion. */
/** The fold glyph (APPROVED by the team, 13 Nov: "Collapse", option A of l/close_pill_icons.png): two vertical chevrons that point at each other, the panel folding together. Never an arrow that points
 *  anywhere (the click folds the panel back into the stack, it sends nothing up). Two centre-line strokes of the line-icon family (16 grid, 1.3 stroke, round caps and joins); each part carries
 *  the way it nudges (px). */
const FOLD_PARTS: readonly (readonly [string, number, number])[] = [['M4.5 3.5L8 6.5l3.5-3', 0, 1.5], ['M4.5 12.5L8 9.5l3.5 3', 0, -1.5]];
const Fold = () => <svg className="sb-apps-panel-fold" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{FOLD_PARTS.map(([d, dx, dy]) => <path key={d} d={d} data-dx={dx} data-dy={dy} />)}</svg>;
/** Hover (APPROVED, l/close_pill_hover.mp4): each chevron nudges 1.5px toward the middle and back, 300ms, the keyframe at 32%, cubic-bezier(.22,1,.36,1); Fast x0.7; none with Reduce motion. It starts
 *  when the pointer enters (or the keyboard focuses the pill), is never cut by leaving, and a new one replaces a running one first, so they never stack. */
const nudgeFold = (svg: SVGSVGElement | null, pace: number, reduced: boolean) => {
  if (!svg || reduced) return;
  for (const path of svg.querySelectorAll<SVGPathElement>('path[data-dx]')) {
    const dx = Number(path.dataset.dx) || 0, dy = Number(path.dataset.dy) || 0;
    for (const running of path.getAnimations()) running.cancel();
    if (dx || dy) path.animate([{ transform: 'translate(0px,0px)' }, { transform: `translate(${dx}px,${dy}px)`, offset: .32 }, { transform: 'translate(0px,0px)' }], { duration: 300 * (pace < 1 ? .7 : 1), easing: 'cubic-bezier(.22,1,.36,1)' });
  }
};

interface PanelProps {
  phase: 'open' | 'closing';
  /** The panel was already open when this sidebar was drawn (a workspace switch, a mode change): it appears open, with no opening motion and without taking the keyboard. */
  settled?: boolean;
  /** Rows of tiles the panel is tall: at least three, as tall as the grid it covers otherwise. */
  rows: number;
  cols: number;
  /** Favorites at the bottom of the sidebar: the panel grows upward and the pill hangs above it. */
  bottom: boolean;
  /** The row the folded Favorites start on: the panel opens scrolled to it. */
  startRow: number;
  count: number;
  stack: RefObject<HTMLButtonElement | null>;
  grid: RefObject<HTMLDivElement | null>;
  /** The Favorites whose plates are in the stack, front first (the icons that travel). */
  flyIds: string[];
  pace: number;
  reduced: boolean;
  label: string;
  foldLabel: string;
  onClose: () => void;
  onClosed: () => void;
  /** Drops into the panel's own grid reorder the Favorites (and take a link or a tab). */
  dragProps: { onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void; onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void; onDrop: (event: ReactDragEvent<HTMLDivElement>) => void };
  children: ReactNode;
}

export function FavoritesPanel({ phase, settled, rows, cols, bottom, startRow, count, stack, grid, flyIds, pace, reduced, label, foldLabel, onClose, onClosed, dragProps, children }: PanelProps) {
  const root = useRef<HTMLDivElement>(null), shade = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), thumb = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef(0), near = useRef(false), quiet = useRef(false);
  const live = useRef({ onClose, onClosed, flyIds, pace, reduced, settled }); live.current = { onClose, onClosed, flyIds, pace, reduced, settled };
  const show = (on: boolean) => thumb.current?.toggleAttribute('data-show', on);
  const flash = () => { show(true); clearTimeout(hideTimer.current); hideTimer.current = window.setTimeout(() => { if (!near.current) show(false); }, 900); };
  const nearEdge = (event: { clientX: number }) => { const box = root.current?.getBoundingClientRect(); if (!box) return; const close = box.right - event.clientX < 22; if (close === near.current) return; near.current = close; if (close) { clearTimeout(hideTimer.current); show(true); } else show(false); };
  const nudge = (event: { currentTarget: HTMLElement }) => nudgeFold(event.currentTarget.querySelector('svg'), live.current.pace, live.current.reduced);
  const edges = () => {
    const sc = scroller.current, node = root.current; if (!sc || !node) return;
    // "more below" is judged on whole pixels with two device pixels of slack: at 125% and 150% the scroll offset can stop a fraction short of the end, and a bottom fade that stayed on faded the last row (E5, the add tile's border)
    const max = sc.scrollHeight - sc.clientHeight, top = sc.scrollTop > 1, more = Math.round(sc.scrollTop) < Math.round(max) - Math.max(1, Math.ceil(2 / (window.devicePixelRatio || 1)));
    sc.dataset.fade = [top ? 'top' : '', more ? 'bottom' : ''].filter(Boolean).join(' ');
    const bar = thumb.current; if (bar) { if (max <= 0) { bar.style.display = 'none'; return; } const h = Math.max(20, sc.clientHeight * sc.clientHeight / sc.scrollHeight); bar.style.display = ''; bar.style.height = h + 'px'; bar.style.transform = `translateY(${(sc.clientHeight - h) * sc.scrollTop / max}px)`; }
  };
  // open: nothing is copied into the panel (a theme or sidebar-colour change while it is open must reach it), it is only the live token surface
  useLayoutEffect(() => {
    if (phase !== 'open') return;
    const node = root.current, sc = scroller.current, st = stack.current, g = grid.current;
    if (!node || !sc || !st || !g || !shade.current) return;
    // it opens on what was folded: the first hidden row at the top (with Favorites at the bottom, at the far end)
    if (live.current.settled) quiet.current = true;   // the scroll position below fires a scroll event: no scroll indicator for a panel that was already open
    sc.scrollTop = bottom ? sc.scrollHeight : Math.min(sc.scrollHeight - sc.clientHeight, startRow * 46); edges();
    if (live.current.settled) { settleOpen({ panel: node, stack: st, grid: g }); requestAnimationFrame(() => requestAnimationFrame(() => { quiet.current = false; })); return; }   // drawn again while open: there as it was, nothing moves and the keyboard stays where it is
    openMorph({ panel: node, shade: shade.current, stack: st, grid: g, flyIds: live.current.flyIds, pace: live.current.pace, reduced: live.current.reduced });
    // keyboard opens move focus to the first folded Favorite; a click leaves focus where the pointer is
    if (st.dataset.opener === 'key') node.querySelector<HTMLElement>(`.sb-apps-panel-grid>[data-app-id="${live.current.flyIds[0]}"]`)?.focus({ preventScroll: true }); else node.focus({ preventScroll: true });
  }, [phase === 'open']); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (phase !== 'closing') return;
    const node = root.current, st = stack.current, g = grid.current;
    if (!node || !st || !g || !shade.current) { settleFavorites(g, st, node); live.current.onClosed(); return; }
    const list = closeMorph({ panel: node, shade: shade.current, stack: st, grid: g, flyIds: live.current.flyIds, pace: live.current.pace, reduced: live.current.reduced });
    let done = false;
    // Esc gives the keyboard back to the stack, at the swap (favoritesStack.ts holdFan): the stack's copy has the ring in by then, and the real stack, shown in the same frame, takes the focus in it.
    // A pointer that rests where the stack comes back, or that focus, holds the fan and the tooltip (data-no-fan) until it leaves and returns, so nothing is added once the motion has ended
    const finish = () => { if (done) return; done = true; settleFavorites(g, st, node); holdFan(st); live.current.onClosed(); };
    Promise.all(list.map(animation => animation.finished)).then(finish, finish);
    // hidden or throttled renderers can hold back finish notifications: never leave the panel up
    const timer = holdMotion() ? 0 : window.setTimeout(finish, (live.current.reduced ? 100 : 560) * live.current.pace + 700);
    return () => clearTimeout(timer);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== 'open') return;
    // Esc folds the panel while the focus is inside it (E6): a click elsewhere, the page taking the keyboard, a popup or the interface losing focus leave it open
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!root.current?.contains(document.activeElement)) return;
      event.preventDefault(); if (stack.current?.dataset.opener === 'key') stack.current.setAttribute('data-refocus', ''); live.current.onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [phase]);
  // nothing may lie under the open panel. Where the panel is taller than the Favorites grid (a short grid: limit 6, or few rows) the sections below move out of its way by exactly
  // the panel's overhang (plus the pill's own 17px band), kept current while the panel is open (sidebar resize, interface size, rows).
  useLayoutEffect(() => {
    const node = root.current, side = node?.closest<HTMLElement>('.acira-sidebar'), region = node?.parentElement;
    if (!node || !side || !region) return;
    const place = () => {
      const p = node.getBoundingClientRect(), r = region.getBoundingClientRect(), zoom = node.offsetHeight ? p.height / node.offsetHeight : 1;
      const over = bottom ? r.top - p.top : p.bottom - r.bottom; side.style.setProperty('--sb-panel-push', `${Math.max(0, Math.ceil(over / zoom))}px`);
    };
    place(); const watch = new ResizeObserver(place); watch.observe(node); watch.observe(region);
    return () => { watch.disconnect(); side.style.removeProperty('--sb-panel-push'); };
  }, [bottom]);
  // however the panel goes (closed, unmounted by a change in the Favorites), the Favorites it hid come back
  useEffect(() => () => { settleFavorites(grid.current, stack.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const style = { '--rows': rows, '--sb-cols': cols } as CSSProperties;
  const leaving = (event: ReactDragEvent<HTMLDivElement>) => {
    // a Favorite dragged out of the panel: the panel folds so the grid it covered is there to drop on (the drop reorders, and the last visible one goes into the stack)
    if (event.dataTransfer.types.includes('application/x-acira-app') && !root.current?.contains(event.relatedTarget as Node | null)) live.current.onClose();
  };
  return <>
    <div ref={shade} className="sb-apps-panel-shade" data-bottom={bottom || undefined} style={style} aria-hidden="true" />
    <div ref={root} className="sb-apps-panel" onPointerMove={nearEdge} onPointerLeave={() => { near.current = false; show(false); }} onDragLeave={leaving} tabIndex={-1} data-bottom={bottom || undefined} role="group" aria-label={`${label}, ${count}`} style={style}>
      <span className="sb-apps-panel-surface" aria-hidden="true" />
      <div ref={scroller} className="sb-apps-panel-scroll" onScroll={() => { edges(); if (!quiet.current && !root.current?.hasAttribute('data-forming')) flash(); }}>
        <div className="sb-apps sb-apps-panel-grid" role="toolbar" aria-label={label} {...dragProps}>{children}</div>
      </div>
      <span ref={thumb} className="sb-apps-panel-thumb" data-panel-chrome aria-hidden="true" />
      <button type="button" className="sb-apps-panel-handle" data-panel-chrome aria-label={foldLabel} onClick={() => live.current.onClose()} onPointerEnter={nudge} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) nudge(event); }}><Fold /></button>
    </div>
  </>;
}
