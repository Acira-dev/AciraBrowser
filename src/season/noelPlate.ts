import { dragEnd, dragStart, followPlate, registerCushion } from './winter/controller';

/**
 * Noël's snow on a plate that is not a tab row (the card that glides to another tab, the preview of a tab being dragged): a copy of the cushion rides on it, so the snow travels with the
 * plate on the compositor, and its position each frame drives the snow's weight (it lifts as the plate sets off and settles with one soft bounce). Returns the function that lets it go.
 * A plate that leaves the page lets go by itself. Nothing is done with the theme off.
 * `drag`: the plate is a tab being dragged: picking it up rolls a grain off, moving sheds a grain now and then (more the faster), and `noelDropped` presses the snow.
 */
export function noelCarry(plate: HTMLElement, opts: { drag?: boolean } = {}): () => void {
  if (typeof document === 'undefined' || !document.documentElement.hasAttribute('data-noel')) return () => {};
  const fx = document.createElement('span'), canvas = document.createElement('canvas');
  fx.className = 'noel-fx'; fx.setAttribute('data-kind', 'sel'); fx.setAttribute('aria-hidden', 'true'); canvas.className = 'noel-cushion'; fx.append(canvas); plate.append(fx);
  let off: (() => void) | null = registerCushion('sel', canvas, fx, 'card');
  const let_go = () => { off?.(); off = null; fx.remove(); }, stop = followPlate(plate, let_go);
  if (opts.drag) dragStart();
  return () => { stop(); let_go(); };
}
/** The dragged tab is put down: 0.2 s into its settling the snow presses, bounces and drops a little (PLAN section 8). */
export function noelDropped(): void { if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-noel')) window.setTimeout(dragEnd, 180); }
