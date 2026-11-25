/**
 * Noël over the whole window: the overlay page's script (bundled to desktop/season-overlay.js by `npm run build`). It draws the flakes that cross the toolbar and the page, in a
 * window of its own that main glues to the page area (desktop/season-overlay.cjs). The same flakes as the sidebar's (`engine.ts`, `draw.ts`), fainter over a page, melting before the
 * bottom, never settling. It runs a 30 fps loop only while there are flakes, rests when main says so (the flakes melt away over 3 s), and tells main when the last one has gone.
 */
import { CLASSES, clamp, createWorld, seedField, shakeGlobe, step, type World } from './engine';
import { makeSprites, tumble, type SpriteSet } from './draw';

declare global { interface Window { noelOverlay?: { onState(fn: (m: Msg) => void): void; ended(): void }; __noelStat?: Stat; __noelTune?: Tune } }
/** For the cost rig only (qa/noel/cheap.mjs): frames a second, the canvas's scale cap and the density, read every frame; nothing sets it in the product. */
interface Tune { fps?: number; scale?: number; amount?: number }
interface Stat { frames: number; drawn: number; flakes: number; run: boolean; w: number; h: number; vis: string }
type Msg = { type: 'config'; dark: boolean; run: boolean } | { type: 'size'; width: number; height: number } | { type: 'shake' };

/** Frames a second, the canvas's scale cap and the density over the page (about four fifths of the sidebar's, PLAN section 3). */
const FPS = 30, SCALE = 2, AMOUNT = .8;
const canvas = document.getElementById('c') as HTMLCanvasElement, g = canvas.getContext('2d')!;
const w: World = createWorld({ W: 1, H: 1 });
w.amount = AMOUNT;                     // over the page about four fifths of the sidebar's density (PLAN section 3)
let sprites: SpriteSet | null = null, dark = true, loop = 0, last = 0, run = false, rampSet = false, endedSent = true;
const tune = (): Tune => window.__noelTune || {};
// D169: what this page last drew, for main's read-out (desktop/season-overlay.cjs probe()); counting only, nothing on screen changes
const stat: Stat = window.__noelStat = { frames: 0, drawn: 0, flakes: 0, run: false, w: 0, h: 0, vis: '' };
const dpr = () => Math.min(tune().scale || SCALE, Math.max(1, window.devicePixelRatio || 1));
function size(width: number, height: number): void {
  const k = dpr(); w.W = width; w.H = height;
  canvas.width = Math.max(1, Math.round(width * k)); canvas.height = Math.max(1, Math.round(height * k));
}
function frame(ts: number): void {
  loop = 0;
  const FRAME = 1000 / (tune().fps || FPS); w.amount = tune().amount || AMOUNT;
  if (last && !w.globe && ts - last < FRAME - 3) { loop = requestAnimationFrame(frame); return; }   // a shake draws every display frame
  const dt = Math.min(.08, last ? (ts - last) / 1000 : 1 / 30); last = ts;
  w.resting = !run; w.eligible = true; w.snow = 'window';
  if (run && !rampSet) { w.rampT0 = ts; rampSet = true; }
  step(w, dt, ts);
  if (canvas.width !== Math.max(1, Math.round(w.W * dpr()))) size(w.W, w.H);   // the scale changed (another display, or the cost rig): the canvas follows
  const k = dpr(); g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, w.W, w.H);
  if (!sprites) sprites = makeSprites(dark);
  let drawn = 0;
  for (const pass of ['far', 'mid', 'near'] as const) for (const f of w.flakes) {
    if (f.cls.id !== pass || f.x < -12 || f.y < -12 || f.x > w.W + 12 || f.y > w.H + 12) continue;
    const list = sprites[f.cls.id], s = list[f.sp % list.length];
    // over a website: fainter, and it melts before the bottom (nothing settles on a page)
    const a = f.a * (dark ? .7 : 1) * (1 - clamp(f.fade, 0, 1)) * clamp(f.life * .7, 0, 1) * (dark ? .85 : 1) * clamp((w.H - 6 - f.y) / 90, 0, 1);
    if (!(a > .01)) continue;
    drawn++;
    g.globalAlpha = a; const half = s.size / 2, tq = tumble(f);
    if (tq) { g.save(); g.translate(f.x, f.y); g.rotate(f.rot); g.scale(1, tq); g.drawImage(s.c, -half, -half, s.size, s.size); g.restore(); } else g.drawImage(s.c, f.x - half, f.y - half, s.size, s.size);
  }
  g.globalAlpha = 1;
  stat.frames++; stat.drawn = drawn; stat.flakes = w.flakes.length; stat.run = run; stat.w = canvas.width; stat.h = canvas.height; stat.vis = document.visibilityState;
  if (w.flakes.length || run) loop = requestAnimationFrame(frame);
  else { last = 0; rampSet = false; g.clearRect(0, 0, w.W, w.H); if (!endedSent) { endedSent = true; window.noelOverlay?.ended(); } }
}
function kick(): void { if (!loop) { last = 0; loop = requestAnimationFrame(frame); } }
window.noelOverlay?.onState(m => {
  // the tree's menu, Shake the globe: the snow over the page is shaken too (the same pushes and swirl, held inside the page), while it snows
  if (m.type === 'shake') { if (run) { shakeGlobe(w, performance.now()); kick(); } return; }
  if (m.type === 'size') { size(m.width, m.height); if (run && !w.flakes.length) seedField(w); kick(); return; }
  if (m.dark !== dark || !sprites) { dark = m.dark; sprites = null; document.body.toggleAttribute('data-light', !dark); }
  const was = run; run = m.run;
  if (run && !was) { endedSent = false; w.resting = false; rampSet = false; seedField(w); }
  kick();
});
void CLASSES;
