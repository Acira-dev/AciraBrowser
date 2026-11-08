import { useEffect, useLayoutEffect, useRef } from 'react';
import { join } from '../../components/DotMatrix';
import { UPDATE_LINE, inkOf, lineColumns, lineDot, lineTarget, shineAt, shineHead, type LineLook } from '../../ui/updateLine';

/** Painted before the browser's next frame where there is a document, so a line that comes with the update never shows an empty canvas for a frame. */
const useBeforePaint = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** The update's dots on the thin line under the sidebar's address field (ui/updateLine.ts is the look, address-in-sidebar.css the fade and the ready colour).
 *  One row of round dots on the 4 px line: the fill follows the real progress, and while `running` a shine travels along the row. Held, ready and `still` (animation
 *  speed Off, reduced motion) are one painted frame: no timer and no frame is left running. The canvas fills the line without taking a pixel of its own and without
 *  taking the pointer (the pill button above it keeps the hit area); it is as wide as the line is, so the line widening under the pointer gains dots at both ends. */
export function UpdateLine({ look, progress, running, still }: { look: LineLook; progress: number; /** The shine is on screen: downloading, speed not Off, and the row is shut. */ running: boolean; /** No motion at all: the dotted progress, still. */ still: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), repaint = useRef<() => void>(() => {});
  // The painter reads these on every frame, so a step of progress does not restart the loop.
  const now = useRef({ look, progress, still });
  now.current = { look, progress, still };
  // The dots' own light, kept across the effect's restarts so a dot that was lit stays lit.
  const shown = useRef<number[]>([]), before = useRef(-1);
  useBeforePaint(() => {
    const node = canvas.current, context = node?.getContext('2d');
    if (!node || !context) return;
    let width = 0, height = 0, ink: [number, number, number] = [37, 38, 43], read = -Infinity;
    const colours = () => { const style = getComputedStyle(node); ink = inkOf(style.getPropertyValue('--ink')) ?? inkOf(style.color) ?? ink; };
    const resize = () => {
      const box = node.getBoundingClientRect(), ratio = Math.max(1, window.devicePixelRatio || 1);
      width = box.width; height = box.height;
      node.width = Math.max(1, Math.round(width * ratio)); node.height = Math.max(1, Math.round(height * ratio));
    };
    const paint = (seconds: number, instant: boolean) => {
      if (!width) return;
      const { look: shape, progress: share, still: calm } = now.current;
      if (seconds - read > 1) { read = seconds; colours(); }
      const columns = lineColumns(width), pitch = UPDATE_LINE.pitch, left = (width - columns * pitch) / 2, middle = height / 2;
      const head = shape === 'run' && !calm ? shineHead(seconds, columns) : null;
      // a dot that becomes lit eases in over about a third of a second; a still line, a held one and a resize show the new state at once
      const step = instant || calm || shape !== 'run' || before.current < 0 ? 1 : Math.min(1, Math.max(0, seconds - before.current) * 8);
      if (!instant) before.current = seconds;
      context.setTransform(node.width / width, 0, 0, node.height / height, 0, 0);
      context.clearRect(0, 0, width, height);
      shown.current.length = columns;
      for (let c = 0; c < columns; c++) {
        const target = lineTarget(shape === 'run' ? 'run' : 'held', seconds, c, columns, shape === 'ready' ? 1 : share, calm), from = shown.current[c] ?? target;
        const light = shown.current[c] = from + (target - from) * step;
        const { alpha, swell } = lineDot(light, shineAt(head, c));
        if (alpha <= .004) continue;
        context.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${alpha.toFixed(3)})`;
        context.beginPath(); context.arc(left + (c + .5) * pitch, middle, pitch * UPDATE_LINE.dot / 2 * (1 + swell), 0, Math.PI * 2); context.fill();
      }
    };
    resize(); paint(performance.now() / 1000, true);
    repaint.current = () => paint(performance.now() / 1000, true);
    // The line widens under the pointer and the colours change with the appearance: a still line paints again; a running one is painted by its loop.
    const watching = new ResizeObserver(() => { resize(); paint(performance.now() / 1000, true); });
    watching.observe(node);
    const themed = new MutationObserver(() => { read = -Infinity; if (!running) paint(performance.now() / 1000, true); });
    const app = node.closest('.app'); if (app) themed.observe(app, { attributes: true, attributeFilter: ['style', 'class', 'data-theme', 'data-finish'] });
    const leave = running ? join((seconds) => { paint(seconds, false); }) : () => {};
    return () => { watching.disconnect(); themed.disconnect(); leave(); repaint.current = () => {}; };
  }, [running]);
  // A step of progress, or a new look, on a line that is not running: one frame.
  useBeforePaint(() => { if (!running) repaint.current(); }, [look, progress, still, running]);
  return <span className="sb-addr-line" aria-hidden="true"><canvas ref={canvas} className="sb-addr-line-dots"/></span>;
}
