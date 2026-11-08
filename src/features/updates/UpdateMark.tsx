import { useEffect, useLayoutEffect, useRef } from 'react';
import { DotMatrix, type MatrixPreset } from '../../components/DotMatrix';
import { dottedTick, gridClearedBy, updateCheckAt, UPDATE_TICK } from '../../ui/matrixShapes';
import { toneColors, type MatrixTone } from '../../ui/matrixTone';

/** The update's dot matrix, on the toolbar's Update pill and in the update and What's new panels: the dots fill with the real progress, then a dotted check is drawn in.
 *  6x6 dots (it was 5x5): the 5x5 check spans four of its five rows, so on the dim grid it hugged the top with an empty row under it and read as stuck
 *  to the top; the 6x6 check is lit on rows 1-4 and columns 0-5, centred on the grid both ways. The dots stay round and clearly there, a little smaller
 *  than before and as far apart (a 7x7 grid made them specks; the old dot-to-cell ratio closed the gaps into bars on a 2x screen). On the pill, which
 *  was too big beside its 12px text, it is 14px (it was 16px); in the panels it fills their 16px icon column, so the title's text edge does not move.
 *  The check itself is no longer six lit grid dots (a tester: "checkmark still sucks": 1.35 px specks that nothing joined, soft at 1x). It is a row of seven 2 px round dots
 *  evenly spaced along a tick, over the same faint grid (founder's pick, 8 Nov 2026; matrixShapes `dottedTick`), painted at the screen's real pixel density so the dots are crisp. */
export const UPDATE_MARK_SIZE = 14, UPDATE_MARK_PANEL_SIZE = 16, UPDATE_MARK_ROWS = 6, UPDATE_MARK_DOT = .58;
/** Painted before the browser's next frame where there is a document, so the swap from the fill to the check never shows an empty canvas for a frame. */
const useBeforePaint = typeof document === 'undefined' ? useEffect : useLayoutEffect;
/** The finish: the fill's last frame (every dot lit) steps back to the faint grid while the tick's dots appear one after another, start to end. */
export const UPDATE_CHECK_MS = 450;

export function UpdateMark({ preset, progress, tone, reducedMotion, panel = false }: { preset: MatrixPreset; progress?: number; tone: MatrixTone; reducedMotion: boolean; /** In a panel's icon column rather than on the pill. */ panel?: boolean }) {
  const size = panel ? UPDATE_MARK_PANEL_SIZE : UPDATE_MARK_SIZE;
  // The finish plays only where the fill was just showing in this very mark (the pill going from downloading to ready); a panel that opens on a ready update shows the tick as it is.
  const sawFill = useRef(false);
  if (preset !== 'check') sawFill.current = true;
  if (preset === 'check') return <UpdateCheck size={size} tone={tone} reducedMotion={reducedMotion} finish={sawFill.current} />;
  return <DotMatrix preset={preset} size={size} rows={UPDATE_MARK_ROWS} dot={UPDATE_MARK_DOT} progress={progress} tone={tone} reducedMotion={reducedMotion} />;
}

/** Paints the check at time `p` of the finish (0 = every grid dot lit, 1 = done), in the lit and faint colours of the tone. */
export function paintUpdateCheck(context: CanvasRenderingContext2D, size: number, on: string, off: string, p: number) {
  const cell = size / UPDATE_MARK_ROWS, gridRadius = cell * UPDATE_MARK_DOT / 2, dotRadius = UPDATE_TICK.dot / 2, dots = dottedTick(size), at = updateCheckAt(p);
  const disc = (x: number, y: number, radius: number) => { context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); };
  for (let r = 0; r < UPDATE_MARK_ROWS; r++) for (let c = 0; c < UPDATE_MARK_ROWS; c++) {
    const x = (c + .5) * cell, y = (r + .5) * cell, keep = gridClearedBy(x, y, gridRadius, dots, dotRadius) ? 1 - at.drawn : 1;
    if (keep <= 0) continue;
    context.globalAlpha = keep; context.fillStyle = off; disc(x, y, gridRadius);
    if (at.grid > 0) { context.globalAlpha = keep * at.grid; context.fillStyle = on; disc(x, y, gridRadius); }
  }
  context.fillStyle = on;
  dots.forEach(([x, y], i) => { const amount = at.dot(i, dots.length); if (amount <= 0) return; context.globalAlpha = amount; disc(x, y, dotRadius * (.5 + .5 * amount)); });
  context.globalAlpha = 1;
}

/** The check, on its own canvas: the faint grid with the dotted tick over it. Painted at the device pixel ratio (not at 2x and shrunk), so 2 px dots on whole-pixel centres are crisp at 1x, 1.5x and 2x.
 *  With `finish` it plays the finish once (450 ms) and then holds still, with no timer or frame left; otherwise, and with reduced motion, it is the done mark at once. */
function UpdateCheck({ size, tone, reducedMotion, finish }: { size: number; tone: MatrixTone; reducedMotion: boolean; finish: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useBeforePaint(() => {
    const node = canvas.current, context = node?.getContext('2d');
    if (!node || !context) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1), pixels = Math.round(size * ratio);
    node.width = pixels; node.height = pixels;
    let on = '', off = '', frame = 0, shown = 1;
    const paint = (p: number) => {
      shown = p;
      const style = getComputedStyle(node);
      [on, off] = toneColors(tone, style.color, style.getPropertyValue('--ed-blue'));
      context.setTransform(pixels / size, 0, 0, pixels / size, 0, 0);
      context.clearRect(0, 0, size, size);
      paintUpdateCheck(context, size, on, off, p);
    };
    const start = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - start) / UPDATE_CHECK_MS);
      paint(p);
      frame = p < 1 ? requestAnimationFrame(step) : 0;
    };
    if (finish && !reducedMotion) step(); else paint(1);
    // The finished mark repaints when the appearance changes (the colours come from the text and the finish accent).
    const themed = new MutationObserver(() => paint(shown));
    const app = node.closest('.app'); if (app) themed.observe(app, { attributes: true, attributeFilter: ['style', 'class', 'data-theme', 'data-finish'] });
    return () => { themed.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [size, tone, reducedMotion, finish]);
  return <canvas ref={canvas} className="dot-matrix" style={{ width: size, height: size }} aria-hidden={true} data-preset="check" />;
}
