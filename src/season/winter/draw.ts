/**
 * Noël's snow, drawn (a port of the study's `mkReal`, `tumble`, `cushion`, `drawCushion`, `drawDrift`). Pure drawing on a 2D context in CSS px:
 * the caller scales the context by the device pixel ratio. Nothing here keeps state.
 */
import { CLASSES, clamp, DRIFT_MAX, driftH, meanOf, type Clump, type Flake, type Ledge, type Puff, type World } from './engine';

export interface Sprite { c: CanvasImageSource; size: number }
export type SpriteSet = Record<'far' | 'mid' | 'near', Sprite[]>;
type Canvas2 = { width: number; height: number; getContext(kind: '2d'): CanvasRenderingContext2D | null };
export type CanvasFactory = () => Canvas2;
const domCanvas: CanvasFactory = () => document.createElement('canvas');

const seededAt = (sd: number) => { let a = (sd * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
/** REAL SNOW: a loose clump of soft lobes (one for the far specks, four for the middle flakes, six for the near ones), each a little translucent at its edge so the clump has an uneven outline and a brighter heart;
 *  the near ones a touch out of focus with a few points where a crystal catches the light. Built once per appearance at 3x; drawn tumbling (see `tumble`). */
function mkReal(factory: CanvasFactory, dark: boolean, r: number, soft: boolean, sd: number): Sprite {
  const rr = seededAt(sd), size = Math.ceil(r * 2 + 8), k = 3, c = factory(), t = factory(); c.width = c.height = t.width = t.height = size * k;
  const g = c.getContext('2d')!, h = t.getContext('2d')!; h.scale(k, k); const cx = size / 2;
  if (soft) h.filter = 'blur(1.4px)';
  const lobes = r < 2.4 ? 2 : r < 4.2 ? 4 : 6;
  for (let i = 0; i < lobes; i++) {
    const ang = i * 2.4 + rr() * 1.2, d = i === 0 ? 0 : r * (.2 + rr() * .24), lr = i === 0 ? r * .66 : r * (.36 + rr() * .2), x = cx + Math.cos(ang) * d, y = cx + Math.sin(ang) * d;
    const gr = h.createRadialGradient(x, y, 0, x, y, lr); gr.addColorStop(0, 'rgba(255,255,255,.96)'); gr.addColorStop(.62, 'rgba(255,255,255,.84)'); gr.addColorStop(.88, 'rgba(255,255,255,.36)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    h.fillStyle = gr; h.beginPath(); h.arc(x, y, lr, 0, 7); h.fill();
  }
  if (r >= 4) { h.filter = 'none'; h.fillStyle = '#fff'; for (let i = 0; i < 3; i++) { const ang = rr() * 6.283, d = r * .42 * rr(); h.beginPath(); h.arc(cx + Math.cos(ang) * d, cx + Math.sin(ang) * d, .3, 0, 7); h.fill(); } }
  // a soft halo of the same clump under it: the outline stays uneven, the edge reads as snow, not as a pebble
  g.filter = 'blur(2.4px)'; g.globalAlpha = dark ? .6 : .5; g.drawImage(t as unknown as CanvasImageSource, 0, 0); g.filter = 'none'; g.globalAlpha = 1;
  if (!dark) { g.shadowColor = 'rgba(55,95,160,.7)'; g.shadowBlur = 1.7 * k; }
  g.globalAlpha = .94; g.drawImage(t as unknown as CanvasImageSource, 0, 0); g.globalAlpha = 1;
  return { c: c as unknown as CanvasImageSource, size };
}
export function makeSprites(dark: boolean, factory: CanvasFactory = domCanvas): SpriteSet {
  return {
    far: [mkReal(factory, dark, 2.4, false, 1), mkReal(factory, dark, 2.2, false, 2), mkReal(factory, dark, 2.0, false, 3)],
    mid: [4.8, 4.4, 4.0, 3.7, 4.6, 4.2].map((r, i) => mkReal(factory, dark, r, false, 10 + i)),
    near: [6.6, 6.0, 5.6, 6.3, 5.8, 5.3].map((r, i) => mkReal(factory, dark, r, true, 20 + i)),
  };
}
/** A flake that is not round tumbles as it falls: it turns, and tilts (its outline shortens and grows back). The far specks do not. */
export const tumble = (f: Flake): number => f.cls.id !== 'far' ? .74 + .26 * Math.abs(Math.cos(f.rot * 1.3 + f.ph)) : 0;

/** The flakes, clumps and crumbs, on the sidebar's canvas (cleared by the caller). Far and middle flakes first, the near ones over them. */
export function drawSnow(g: CanvasRenderingContext2D, w: World, sp: SpriteSet): void {
  for (const pass of ['far', 'mid', 'near'] as const) for (const f of w.flakes) {
    if (f.cls.id !== pass) continue;
    if (f.x < -12 || f.y < -12 || f.x > w.W + 12 || f.y > w.H + 12) continue;
    const list = sp[f.cls.id], s = list[f.sp % list.length], a = f.a * (1 - clamp(f.fade, 0, 1)) * clamp(f.life * .7, 0, 1);
    if (!(a > .01)) continue;
    g.globalAlpha = a; const half = s.size / 2, tq = tumble(f);
    if (tq) { g.save(); g.translate(f.x, f.y); g.rotate(f.rot); g.scale(1, tq); g.drawImage(s.c, -half, -half, s.size, s.size); g.restore(); }
    else g.drawImage(s.c, f.x - half, f.y - half, s.size, s.size);
  }
  drawClumps(g, w.clumps, sp);
  drawPuffs(g, w.puffs);
  g.globalAlpha = 1;
}
function drawClumps(g: CanvasRenderingContext2D, clumps: readonly Clump[], sp: SpriteSet): void {
  const s = sp.mid[0];
  for (const c of clumps) { const z = c.r * 2.7; g.globalAlpha = .97; g.drawImage(s.c, c.x - z / 2, c.y - z / 2, z, z); const ox = Math.cos(c.rot) * c.r * .55, oy = Math.sin(c.rot) * c.r * .4, z2 = z * .72; g.drawImage(s.c, c.x + ox - z2 / 2, c.y + oy - z2 / 2, z2, z2); }
}
function drawPuffs(g: CanvasRenderingContext2D, puffs: readonly Puff[]): void {
  for (const p of puffs) { g.globalAlpha = clamp(1 - p.t / p.life, 0, 1) * .9; g.fillStyle = '#fff'; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
}

/* ---------- the cushion ---------- */
/** The heights a ledge has caught, smoothed into one soft pillow that is thickest in the middle and thins to nothing at the ends. */
export function cushion(e: Ledge): Float32Array {
  const n = e.h.length, r = 3; let a = e.h;
  for (let pass = 0; pass < 2; pass++) { const b = new Float32Array(n); let sum = 0, c = 0; for (let i = -r; i <= r; i++) if (i >= 0 && i < n) { sum += a[i]; c++; } for (let i = 0; i < n; i++) { b[i] = sum / c; const out = i - r, inn = i + r + 1; if (out >= 0) { sum -= a[out]; c--; } if (inn < n) { sum += a[inn]; c++; } } a = b; }
  const mean = meanOf(e), level = Math.min(1, mean / (e.max * .45));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const u = (i + .5) / n, env = e.rad ? .5 + .5 * Math.pow(Math.max(0, 1 - Math.pow(2 * u - 1, 2)), .6) : Math.pow(Math.max(0, 1 - Math.pow(2 * u - 1, 2)), .55), local = Math.min(1, a[i] / Math.max(.2, mean)); out[i] = e.max * Math.pow(level, .6) * env * (.6 + .4 * local) * (.62 + .38 * e.shape[i]); }
  return out;
}
/** How visible the two glints are: they go with the snow. */
export const glintOpacity = (e: Ledge): number => clamp((meanOf(e) - .45) / 1.0, 0, 1);
/** Draws one cushion into its own picture (cleared by the caller). `def` is the weight's spring state for the selected tab's cushion (lift when the plate drops away, press when it pushes up). */
export function drawCushion(g: CanvasRenderingContext2D, e: Ledge, dark: boolean, def?: { d: number }): void {
  const h = cushion(e), n = h.length, D = def ?? { d: 0 };
  const lift = Math.max(0, D.d) * .8, sq = clamp(D.d < 0 ? 1 + D.d * .2 : 1 + D.d * .05, .62, 1.18);
  let mx = 0; for (let i = 0; i < n; i++) { h[i] *= sq; if (h[i] > mx) mx = h[i]; }
  if (mx < .25) return;
  const rad = e.rad, step = (e.x1 - e.x0) / n, X = (i: number) => e.x0 + (i + .5) * step, Yp = e.y, Y0 = Yp - lift;
  // where the plate's top is under each column: on the rounded corners it curves down, and the snow follows it a little way
  const drop = (i: number) => { if (!rad) return 0; const x = X(i), dx = Math.min(x - e.x0, e.x1 - x); if (dx >= rad) return 0; const u = rad - Math.max(0, dx); return Math.min(4.2, rad - Math.sqrt(Math.max(0, rad * rad - u * u))); };
  const base = (i: number) => Y0 + drop(i), top = (i: number) => base(i) - h[i] * (rad ? (.55 + .45 * Math.min(1, (Math.min(X(i) - e.x0, e.x1 - (X(i)))) / rad)) : 1);
  g.globalAlpha = 1;
  // where the snow meets the frost: its compacted base, an icy band that runs down into the frost and fades (no dark shadow)
  const ice = dark ? '226,239,255' : '140,178,228', sh = g.createLinearGradient(0, Yp - .5, 0, Yp + 6); sh.addColorStop(0, `rgba(${ice},${dark ? .5 : .42})`); sh.addColorStop(.45, `rgba(${ice},${dark ? .18 : .16})`); sh.addColorStop(1, `rgba(${ice},0)`);
  g.beginPath(); g.moveTo(X(0), Yp + drop(0) - .5); for (let i = 0; i < n; i++) g.lineTo(X(i), Yp + drop(i) + 1.2 + h[i] * .9); g.lineTo(X(n - 1), Yp + drop(n - 1) - .5); for (let i = n - 1; i >= 0; i--) g.lineTo(X(i), Yp + drop(i) - .5); g.closePath(); g.fillStyle = sh; g.fill();
  // the body: from a small lip over the left corner, along a smooth top, to a lip over the right corner, closed along the plate's outline
  const lipL = rad ? Math.min(2.4, h[0] * .9 + .6) : 0, lipR = rad ? Math.min(2.4, h[n - 1] * .9 + .6) : 0;
  g.beginPath(); g.moveTo(X(0) - (rad ? .9 : 0), base(0) + lipL);
  if (rad) g.quadraticCurveTo(X(0) - 1.3, top(0), X(0) + 1, top(0));
  for (let i = 0; i < n - 1; i++) { const xm = (X(i) + X(i + 1)) / 2, ym = (top(i) + top(i + 1)) / 2; g.quadraticCurveTo(X(i), top(i), xm, ym); }
  if (rad) g.quadraticCurveTo(X(n - 1) + 1.3, top(n - 1), X(n - 1) + .9, base(n - 1) + lipR); else g.lineTo(X(n - 1), base(n - 1) + .7);
  for (let i = n - 1; i >= 0; i--) g.lineTo(X(i), base(i) + .35 + (e.jag ? e.jag[i] : .35));
  g.closePath();
  const gr = g.createLinearGradient(0, Y0 - mx, 0, Y0 + 4.5); gr.addColorStop(0, '#ffffff'); gr.addColorStop(.55, dark ? 'rgba(248,251,255,.98)' : '#fbfdff'); gr.addColorStop(1, dark ? 'rgba(226,238,253,.94)' : 'rgba(222,233,248,1)');
  if (!dark) { g.shadowColor = 'rgba(60,95,150,.55)'; g.shadowBlur = 1.2; }
  g.fillStyle = gr; g.fill(); g.shadowBlur = 0; g.shadowColor = 'transparent';
  // a hair of light along the top
  g.beginPath(); let on = false; for (let i = 0; i < n; i++) { const y = top(i) + .35; if (h[i] > .35) { if (!on) { g.moveTo(X(i), y); on = true; } else g.lineTo(X(i), y); } else on = false; }
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = .6; g.stroke();
  // two or three glints where it is deepest
  g.fillStyle = '#fff'; e.spark.slice(0, 3).forEach(sp => { const i = Math.floor(sp * (n - 1)); if (h[i] > mx * .6) { g.globalAlpha = .95; g.fillRect(X(i) - .4, top(i) + h[i] * .45, .8, .8); } }); g.globalAlpha = 1;
  if (e.id === 'sel') drawGlints(g, e, dark);
}
/** The tab's two glints (still: a point with a hair of light across it), above the snow's top, at .28 and .71 of its width; they go with the snow. */
function drawGlints(g: CanvasRenderingContext2D, e: Ledge, dark: boolean): void {
  const k = glintOpacity(e); if (k <= .02) return;
  const w = e.x1 - e.x0;
  for (const [u, dy] of [[.28, -2.2], [.71, -2.6]] as const) {
    const x = e.x0 + w * u, y = e.y + dy; g.save(); g.globalAlpha = .62 * k;
    const rg = g.createRadialGradient(x, y, 0, x, y, 3.4); rg.addColorStop(0, '#fff'); rg.addColorStop(.3, 'rgba(255,255,255,.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(x - 4, y - 4, 8, 8);
    if (!dark) { g.shadowColor = 'rgba(70,110,170,.8)'; g.shadowBlur = .7; }
    const hl = g.createLinearGradient(x - 4, 0, x + 4, 0); hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(.5, '#fff'); hl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = hl; g.fillRect(x - 4, y - .5, 8, 1);
    const vl = g.createLinearGradient(0, y - 4, 0, y + 4); vl.addColorStop(0, 'rgba(255,255,255,0)'); vl.addColorStop(.5, '#fff'); vl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = vl; g.fillRect(x - .5, y - 4, 1, 8);
    g.restore();
  }
}

/** The drift by Personal: a low bank along the bottom, in its own small picture (`height` px tall, its foot on the sidebar's foot). Returns false when there is nothing to draw. */
export function drawDrift(g: CanvasRenderingContext2D, w: World, height: number, dark: boolean): boolean {
  const d = w.drift; if (!d) return false; const n = d.n; let mx = 0; const s = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < n) { a += driftH(w, j); c++; } } s[i] = a / c; if (s[i] > mx) mx = s[i]; }
  if (mx < .3) return false;
  const X = (i: number) => i * 2, Yb = height + 1;
  g.globalAlpha = 1; g.beginPath(); g.moveTo(X(0) - 2, Yb); g.lineTo(X(0) - 2, Yb - s[0]);
  for (let i = 0; i < n - 1; i++) { const xm = (X(i) + X(i + 1)) / 2, ym = Yb - (s[i] + s[i + 1]) / 2; g.quadraticCurveTo(X(i), Yb - s[i], xm, ym); }
  g.lineTo(X(n - 1) + 2, Yb - s[n - 1]); g.lineTo(X(n - 1) + 2, Yb); g.closePath();
  const gr = g.createLinearGradient(0, Yb - mx, 0, Yb); gr.addColorStop(0, '#ffffff'); gr.addColorStop(.5, dark ? 'rgba(246,250,255,.97)' : '#fbfdff'); gr.addColorStop(1, dark ? 'rgba(212,229,250,.93)' : 'rgba(214,228,246,1)');
  if (!dark) { g.shadowColor = 'rgba(60,95,150,.5)'; g.shadowBlur = 1.2; }
  g.fillStyle = gr; g.fill(); g.shadowBlur = 0; g.shadowColor = 'transparent';
  g.beginPath(); for (let i = 0; i < n; i++) { const y = Yb - s[i] + .35; if (i === 0) g.moveTo(X(i), y); else g.lineTo(X(i), y); } g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = .6; g.stroke();
  return true;
}
export { CLASSES, DRIFT_MAX };
