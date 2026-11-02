import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { blendSizes, equalizeSplit, handleKey, movesWith, normalizeFractions, paneEdges, resizeSplit, rowSets, splitHandles, type Linear, type Rect, type SplitHandle, type SplitSizes, type SplitState } from '../../runtime/splitLayout';
import { t } from '../../i18n';
import './split.css';

/** Multi-pane split view (master list §9; B leads the Snap Layouts UX on top). The page area holds the panes at percentages of its size
 *  (splitLayout.paneEdges), so a resize moves every box in one style change and the native website views follow the panes' boxes.
 *  R3-81: every edge between two panes is its own handle (resizes only those panes); where a column edge meets row segments the junction
 *  moves them all. Drag, or Tab to an edge and use the arrow keys; double-click (or Enter, Home) evens just the panes it separates. */
export const SPLIT_GAP = 6, SPLIT_MIN_PANE = 320;
const EDGE = 10, JUNCTION = 16, SNAP_PX = 8, KEY_STEP = 16, KEY_STEP_BIG = 64, EQUALIZE_MS = 240;

const calc = (value: Linear) => `calc(${value.pct}% + ${value.px}px)`;
/** The page area for a split: panes are placed in it by percentages, so it needs no grid. */
export function splitGridStyle(_split: SplitState): CSSProperties { return { display: 'block' }; }
/** Where pane `index` sits in the page area (cells it spans merge, including the gap between them). */
export function paneArea(split: SplitState, index: number): CSSProperties {
  const edge = paneEdges(split, SPLIT_GAP)[index];
  return edge ? { position: 'absolute', left: calc(edge.left), top: calc(edge.top), width: calc(edge.width), height: calc(edge.height) } : {};
}

/** The speed setting (Premium 1.7, Fast 1, Off 0), read when an animation starts; the OS reduced-motion setting means Off. */
function speed(): number {
  const node = document.querySelector('.app');
  if (!node || node.getAttribute('data-reduced-motion') === 'true') return node ? 0 : 1;
  const value = parseFloat(getComputedStyle(node).getPropertyValue('--motion-scale'));
  return Number.isFinite(value) ? Math.max(0, value) : 1;
}
const sameSizes = (a: SplitSizes, b: SplitSizes) => JSON.stringify([a.cols, a.rows, a.colRows ?? null]) === JSON.stringify([b.cols, b.rows, b.colRows ?? null]);
const label = (handle: SplitHandle) => handle.kind === 'col' ? t('splitresize.cols') : handle.kind === 'row' ? t('splitresize.rows') : t('splitresize.corner');
const easeOut = (x: number) => 1 - Math.pow(1 - x, 4);

/** The edges between panes and their junctions, over the gaps. */
export function SplitHandles({ split, onResize, onDragging }: { split: SplitState; onResize: (sizes: SplitSizes) => void; onDragging?: (dragging: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null), [box, setBox] = useState<Rect | null>(null);
  const [hover, setHover] = useState<string | null>(null), [active, setActive] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; start: SplitState; handle: SplitHandle } | null>(null);
  const pending = useRef<SplitSizes | null>(null), frame = useRef(0), tween = useRef(0), latest = useRef(split), callbacks = useRef({ onResize, onDragging });
  latest.current = split; callbacks.current = { onResize, onDragging };
  const stopTween = () => { if (tween.current) { cancelAnimationFrame(tween.current); tween.current = 0; callbacks.current.onDragging?.(false); } };
  useEffect(() => {
    const host = root.current?.parentElement; if (!host) return;
    const measure = () => setBox({ x: 0, y: 0, width: host.clientWidth, height: host.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(host);
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); frame.current = 0; stopTween(); };
  }, []);
  if (!box) return <div ref={root} className="split-handles" aria-hidden/>;
  const handles = splitHandles(split, box, SPLIT_GAP, EDGE, JUNCTION);
  const apply = (sizes: SplitSizes | null) => { if (sizes && !sameSizes(sizes, latest.current)) onResize(sizes); };
  /** One resize per frame, the newest: the native page views follow the panes' boxes as fast as the frames come. */
  const queue = (sizes: SplitSizes) => { pending.current = sizes; if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; const next = pending.current; pending.current = null; apply(next); }); };
  const flush = () => { cancelAnimationFrame(frame.current); frame.current = 0; const next = pending.current; pending.current = null; apply(next); };
  /** Evens the panes this handle separates, gliding there at the speed setting (at once when the speed is Off). */
  const equalize = (handle: SplitHandle) => {
    stopTween(); flush();
    const from = latest.current, to = equalizeSplit(from, handle), scale = speed();
    if (sameSizes(to, from)) return;
    if (scale <= 0) { onResize(to); return; }
    const began = performance.now(), duration = EQUALIZE_MS * scale; onDragging?.(true);
    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / duration);
      if (progress >= 1) { tween.current = 0; callbacks.current.onResize(to); callbacks.current.onDragging?.(false); return; }
      callbacks.current.onResize(blendSizes(from.layout, from, to, easeOut(progress))); tween.current = requestAnimationFrame(step);
    };
    tween.current = requestAnimationFrame(step);
  };
  const down = (handle: SplitHandle) => (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return; event.preventDefault(); stopTween();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: latest.current, handle }; setActive(handleKey(handle)); onDragging?.(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (d?.pointerId !== event.pointerId) return;
    queue(resizeSplit(d.start, d.handle, event.clientX - d.x, event.clientY - d.y, box, SPLIT_GAP, SPLIT_MIN_PANE, event.altKey ? 0 : SNAP_PX));
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return; flush(); drag.current = null; setActive(null); onDragging?.(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const key = (handle: SplitHandle) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Home' || event.key === 'Enter') { event.preventDefault(); equalize(handle); return; }
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const dx = handle.kind !== 'row' ? (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) : 0, dy = handle.kind !== 'col' ? (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) : 0;
    if (!dx && !dy) return; event.preventDefault(); stopTween(); apply(resizeSplit(latest.current, handle, dx, dy, box, SPLIT_GAP, SPLIT_MIN_PANE));
  };
  // What lights up: the handle under the pointer (or being dragged), and what moves together with it, never its neighbours.
  const focus = active ?? hover, lit = new Set<string>(), target = handles.find(handle => handleKey(handle) === focus);
  if (target) { lit.add(handleKey(target)); movesWith(target).forEach(id => lit.add(id)); }
  const value = (handle: SplitHandle) => handle.kind === 'col' ? normalizeFractions(split.cols, split.cols.length)[handle.col!] : handle.kind === 'row' ? rowSets(split)[handle.column ?? 0][handle.row!] : undefined;
  return <div ref={root} className="split-handles">
    {handles.map(handle => {
      const id = handleKey(handle), now = value(handle);
      return <div key={id} className="split-handle" data-kind={handle.kind} data-lit={lit.has(id) || undefined} data-active={active === id || undefined} role="separator" tabIndex={handle.kind === 'corner' ? -1 : 0} aria-label={label(handle)}
        aria-hidden={handle.kind === 'corner' || undefined} aria-orientation={handle.kind === 'row' ? 'horizontal' : 'vertical'} aria-valuenow={now === undefined ? undefined : Math.round(now * 100)}
        style={{ left: handle.rect.x, top: handle.rect.y, width: handle.rect.width, height: handle.rect.height }}
        onPointerDown={down(handle)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onKeyDown={key(handle)}
        onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(current => current === id ? null : current)} onDoubleClick={() => equalize(handle)}/>;
    })}
  </div>;
}
