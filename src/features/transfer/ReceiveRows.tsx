// The part rows of R4, R5, R7 and the steps of R6 (pictures 14, 14b, 15, 16, 17): a tick, the part's name, and its counts under it.
//   - R4: rows enter on the 40 ms stagger as soon as the manifest is known (moment 9), wait with a dot, and tick in order 60 ms apart as each section passes its check
//     (moment 10): the tick is a CheckMark stroke drawn in 180 ms (at Premium; the speed setting scales it, Off cuts).
//   - R5: every row ticked; a click leaves a part out (role checkbox, the same stroke).
//   - R6: the steps main finishes tick, the one it is on shows the small loader.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DotMatrix } from '../../components/DotMatrix';
import { CheckMark } from '../../components/CheckMark';
import { motionScale, motionSpeed } from '../../ui/sharedMotion';
import { enterStagger } from './sheetMotion';
import type { ReceiveRowModel } from './receiveParts';

/** The time between one tick and the next while the data is checked (spec 5.1 moment 10). */
export const TICK_GAP_MS = 60;
/** The stroke of a tick takes 180 ms at Premium (moment 10); Fast and Off scale it with the speed setting (Off: no drawing). */
export const tickMs = (): number => (motionSpeed() === 'off' ? 0 : Math.round(180 * motionScale('E') / 1.4));
const FALLBACK_EASE = 'cubic-bezier(.23, 1, .32, 1)';

/** Draws a tick's stroke from its start to its end. */
export function drawStroke(path: SVGPathElement | null | undefined, ms: number): Animation | null {
  if (!path || ms <= 0 || typeof path.getTotalLength !== 'function' || typeof path.animate !== 'function') return null;
  const length = path.getTotalLength();
  if (!length) return null;
  const ease = getComputedStyle(document.documentElement).getPropertyValue('--motion-ease-enter').trim() || FALLBACK_EASE;
  path.style.strokeDasharray = String(length);
  const animation = path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration: ms, easing: ease, fill: 'both' });
  animation.finished.then(() => { path.style.strokeDasharray = ''; animation.cancel(); }, () => { path.style.strokeDasharray = ''; });
  return animation;
}

function Tick({ draw }: { draw: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => { if (draw) drawStroke(ref.current?.querySelector('path'), tickMs()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <CheckMark ref={ref} size={16} className="tx-tick" />;
}

export interface ReceiveRowsProps {
  rows: ReceiveRowModel[];
  /** One column (R6) instead of two. */
  one?: boolean;
  /** R5: a click on a row leaves its part out or brings it back. */
  onToggle?: (row: ReceiveRowModel['id']) => void;
  /** New rows enter one after another, 40 ms apart. */
  stagger?: boolean;
  /** A row that becomes ticked while the screen is open draws its stroke. */
  drawTicks?: boolean;
  label?: string;
}

function Row({ row, onToggle, drawTicks }: { row: ReceiveRowModel; onToggle?: ReceiveRowsProps['onToggle']; drawTicks: boolean }) {
  const born = useRef(row.state === 'tick');
  const ticked = row.state === 'tick' && !row.off;
  const mark = <span className="tk" aria-hidden="true">{ticked ? <Tick draw={drawTicks && !born.current} /> : <i className="tx-dot" />}</span>;
  const text = <span><span className="nm">{row.name}</span>{row.sub && <small className="tx-row-sub">{row.sub}</small>}</span>;
  const data = { 'data-row': row.id, 'data-wait': ticked ? undefined : '', 'data-later': row.state === 'later' ? '' : undefined, 'data-off': row.off ? '' : undefined };
  return onToggle
    ? <button type="button" role="checkbox" aria-checked={!row.off} className="tx-row" {...data} onClick={() => onToggle(row.id)}>{mark}{text}</button>
    : <div className="tx-row" role="listitem" {...data}>{mark}{text}</div>;
}

export function ReceiveRows({ rows, one = false, onToggle, stagger = false, drawTicks = false, label }: ReceiveRowsProps) {
  const list = useRef<HTMLDivElement>(null), shown = useRef(0);
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = rows.length;
    if (stagger && rows.length > before && list.current) enterStagger(Array.from(list.current.children).slice(before));
  }, [rows.length, stagger]);
  return <div ref={list} className={`tx-rows${one ? ' one' : ''}`} role={onToggle ? 'group' : 'list'} aria-label={label}>{rows.map((row) => <Row key={row.id} row={row} onToggle={onToggle} drawTicks={drawTicks} />)}</div>;
}

function ApplyRow({ row, reducedMotion }: { row: { id: string; name: string; state: 'tick' | 'live' | 'wait' }; reducedMotion?: boolean }) {
  const born = useRef(row.state === 'tick');
  return (
    <div className="tx-row" role="listitem" data-step={row.id} data-wait={row.state === 'wait' ? '' : undefined} data-live={row.state === 'live' ? '' : undefined}>
      <span className="tk" aria-hidden="true">{row.state === 'tick' ? <Tick draw={!born.current} /> : row.state === 'live' ? <DotMatrix preset="loader" size={14} rows={5} cols={5} reducedMotion={reducedMotion} className="tx-live-grid" /> : <i className="tx-dot" />}</span>
      <span><span className="nm">{row.name}</span></span>
    </div>
  );
}
/** The steps of R6: a tick when main has finished it, the small loader while it works on it, a dot while it waits. */
export function ApplyList({ rows, reducedMotion }: { rows: { id: string; name: string; state: 'tick' | 'live' | 'wait' }[]; reducedMotion?: boolean }) {
  return <div className="tx-rows one" role="list">{rows.map((row) => <ApplyRow key={row.id} row={row} reducedMotion={reducedMotion} />)}</div>;
}

/**
 * How many rows have their tick while the data is checked: one more every 60 ms once `active`, up to `total`; at once at Animation speed Off. `onDone` is called when all are
 * ticked (R4 holds on screen until then, so the ticks are seen, never skipped by an early R5).
 */
export function useSequentialTicks(total: number, active: boolean, onDone?: () => void, gap = TICK_GAP_MS): number {
  const [count, setCount] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!active) return;
    if (total === 0 || motionSpeed() === 'off') { setCount(total); return; }
    setCount((current) => (current > total ? total : current));
    const timer = setInterval(() => setCount((current) => (current >= total ? current : current + 1)), gap);
    return () => clearInterval(timer);
  }, [active, total, gap]);
  const finished = active && count >= total;
  useEffect(() => { if (finished) done.current?.(); }, [finished]);
  return active ? count : 0;
}
