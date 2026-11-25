import { useLayoutEffect, useRef, type RefObject } from 'react';
import { AURA_CELLX, AURA_ROWS, createAuraKernel, mixPalettes, PALETTE_EASE_MS, paletteCurve, pauseEase, stepPause, toLab, toRgb, type AuraKernel } from './nowPlayingAura';
import { motionSpeed } from './sharedMotion';

/** Hooks for rigs, read only when a rig sets it: `t` freezes the wave clock at that second, `cost` collects the script time of every
 * painted frame (the glow's per-frame budget is in tests/now-playing-aura.test.ts and the report). Nothing here runs in normal use. */
declare global { interface Window { __npAura?: { t?: number; cost?: { frames: number; ms: number } } } }

/** Any CSS colour (oklch(...), rgb(... / a)) as premultiplied sRGB 0..1, through a 1 x 1 canvas. */
let probe: CanvasRenderingContext2D | null | undefined;
function resolve(css: string): number[] {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) return [.5, .5, .5];
  probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = css; probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data; return [d[0] / 255, d[1] / 255, d[2] / 255].map(v => v * d[3] / 255);
}

let kernel: AuraKernel | null = null;

interface State { T: number; u: number; last: number; raf: number; running: boolean; from: number[][] | null; to: number[][] | null; c0: number; key: string; rgb: number[][] | null; rgbOf: number[][] | null }

/** Draws the card's glow (src/ui/nowPlayingAura.ts) into the two canvases inside `.np-wrap`: the waves (`canvas.np-aura`) and the lit
 * bottom border (`canvas.np-aura-edge`). One rAF loop while the card is open and the sound plays; it also runs through the 1 s pause
 * ease and a 0.9 s colour ease, then stops. Folded, nothing is painted or scheduled; with motion off it paints once. The loop writes
 * two tiny canvases (56 x 36 and 56 x 1 on a standard card) that the compositor scales: no layout, no style, no window repaint.
 * No 2D context or any error while painting: `data-aura="css"` on the wrap and a still CSS band takes over. */
export function useAura(wrap: RefObject<HTMLDivElement | null>, colors: string[], live: boolean, playing: boolean, still: boolean) {
  const st = useRef<State>({ T: 0, u: playing ? 0 : 1, last: 0, raf: 0, running: false, from: null, to: null, c0: 0, key: '', rgb: null, rgbOf: null });
  const key = colors.join('|');
  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const s = st.current, cv = el.querySelector<HTMLCanvasElement>('canvas.np-aura'), ce = el.querySelector<HTMLCanvasElement>('canvas.np-aura-edge');
    const ctx = cv?.getContext('2d'), ectx = ce?.getContext('2d');
    if (!cv || !ce || !ctx || !ectx) { el.dataset.aura = 'css'; return; }
    // The colours: resolved when they change, eased to from what is shown (or started there).
    const labAt = (now: number): number[][] => {
      if (!s.from || !s.to) return [];
      const k = s.c0 === 0 ? 1 : s.c0 < 0 ? 0 : paletteCurve(Math.min(1, (now - s.c0) / PALETTE_EASE_MS));
      return mixPalettes(s.from, s.to, k);
    };
    if (s.key !== key) {
      const next = colors.map(resolve).map(toLab), shown = s.to && s.from ? labAt(performance.now()) : null;
      s.from = shown ?? next; s.to = next; s.c0 = shown ? -1 : 0; s.key = key; s.rgb = null;
    }
    // Settled colours are converted once; only an ease converts every frame.
    const colorsAt = (now: number): number[][] => {
      const settled = s.c0 === 0 || (s.c0 > 0 && now - s.c0 >= PALETTE_EASE_MS);
      if (settled && s.rgb && s.rgbOf === s.to) return s.rgb;
      const rgb = labAt(now).map(toRgb);
      if (settled) { s.rgb = rgb; s.rgbOf = s.to; }
      return rgb;
    };
    kernel ??= createAuraKernel();
    const target = playing ? 0 : 1;
    let img: ImageData | null = null, eimg: ImageData | null = null;
    const paint = (now: number) => {
      const W = Math.max(40, el.clientWidth), nx = Math.round(W / AURA_CELLX);
      if (cv.width !== nx) { cv.width = nx; cv.height = AURA_ROWS; ce.width = nx; ce.height = 1; }
      if (!img || img.width !== nx) { img = ctx.createImageData(nx, AURA_ROWS); eimg = ectx.createImageData(nx, 1); }
      const hook = window.__npAura, light = el.closest('.app')?.getAttribute('data-appearance') === 'light';
      kernel!.render({ columns: nx, t: hook?.t ?? s.T, pz: pauseEase(s.u), colors: colorsAt(now), light }, img.data, eimg!.data);
      ctx.putImageData(img, 0, 0); ectx.putImageData(eimg!, 0, 0);
    };
    const safe = (now: number) => { try { paint(now); return true; } catch { el.dataset.aura = 'css'; return false; } };
    delete el.dataset.aura;
    cancelAnimationFrame(s.raf); s.running = false; s.last = 0;
    const off = !motionSpeed() || motionSpeed() === 'off';
    if (off) { s.u = target; s.c0 = 0; }
    const cleanups: (() => void)[] = [() => cancelAnimationFrame(s.raf)];
    // A folded card paints nothing (its glow is invisible and its last frame stays for the fold). Open: one frame now, and a frame again
    // when the card is resized or the theme changes while the loop is not running.
    if (!live) return () => cleanups.forEach(c => c());
    if (!safe(performance.now())) return () => cleanups.forEach(c => c());
    const repaint = () => { if (!s.running) safe(performance.now()); };
    const resize = new ResizeObserver(repaint); resize.observe(el); cleanups.push(() => resize.disconnect());
    const app = el.closest('.app');
    if (app) { const theme = new MutationObserver(repaint); theme.observe(app, { attributes: true, attributeFilter: ['data-appearance'] }); cleanups.push(() => theme.disconnect()); }
    if (off) return () => cleanups.forEach(c => c());
    const tick = (now: number) => {
      const cost = window.__npAura?.cost, t0 = cost ? performance.now() : 0;
      const dt = s.last ? Math.min(.1, Math.max(0, (now - s.last) / 1000)) : 0; s.last = now;
      if (s.c0 === -1) s.c0 = now;   // the colour ease starts on the first frame
      s.u = stepPause(s.u, target, dt);
      if (!still) s.T += dt * (1 - pauseEase(s.u));
      if (!safe(now)) { s.running = false; return; }
      if (cost) { cost.frames++; cost.ms += performance.now() - t0; }
      const easing = s.c0 > 0 && now - s.c0 < PALETTE_EASE_MS;
      if ((playing && !still) || s.u !== target || easing) s.raf = requestAnimationFrame(tick); else s.running = false;
    };
    s.running = true; s.raf = requestAnimationFrame(tick);
    return () => cleanups.forEach(c => c());
  }, [wrap, key, live, playing, still]);// eslint-disable-line react-hooks/exhaustive-deps
}
