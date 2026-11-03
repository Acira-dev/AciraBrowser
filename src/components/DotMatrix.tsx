import { useEffect,useRef } from 'react';
import { blend,switchedOff,torConnecting,torConnected,torStopped,privateSweep,audioBars,checkLights,downloadFill,progressHeld } from '../ui/matrixShapes';
import { toneColors,type MatrixTone } from '../ui/matrixTone';

/** The acirabrowser.com status lights, ported from its site.js: a small dot grid showing what an agent is actually doing.
 * Working = loader, Reading = scan, Needs you = heartbeat, Paused = still, Seen = switched off. Round 2: the classic
 * square grid only — Tor and private are patterns of light through the whole grid, never a picture drawn in dots. */
export type MatrixPreset = 'loader' | 'heartbeat' | 'weave' | 'pulse' | 'scan' | 'still' | 'idle' | 'bars' | 'off' | 'tor' | 'torConnecting' | 'torStopped' | 'private' | 'audio' | 'check' | 'download' | 'downloadHeld' | 'progress' | 'progressHeld';
export type { MatrixTone };

const TAU = Math.PI * 2;
const clamp = (value: number, low: number, high: number) => value < low ? low : value > high ? high : value;
function bezier(x1: number, y1: number, x2: number, y2: number) {
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const cx = 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t - x;
      const dx = 3 * x1 * (1 - t) * (1 - 3 * t) + 3 * x2 * t * (2 - 3 * t) + 3 * t * t;
      if (Math.abs(cx) < 1e-4 || !dx) break;
      t = clamp(t - cx / dx, 0, 1);
    }
    return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
  };
}

// Needs you: a 1.6s lub-dub opacity curve; each dot starts 24ms later per unit of distance from the centre.
const heartbeatEase = bezier(.25, 1, .5, 1), heartbeatKeys = [[0, .18], [.06, .95], [.14, .3], [.22, 1], [.34, .2], [.7, .18], [1, .18]];
const rest = (value: number) => Math.max(0, (value - .18) / .82);
function heartbeat(t: number, r: number, c: number, R: number, C: number) {
  const d = Math.hypot(c - (C - 1) / 2, r - (R - 1) / 2), u = (((t - d * .024) % 1.6) + 1.6) % 1.6 / 1.6;
  for (let i = 1; i < heartbeatKeys.length; i++) if (u <= heartbeatKeys[i][0]) {
    const a = heartbeatKeys[i - 1], b = heartbeatKeys[i];
    return rest(a[1] + (b[1] - a[1]) * heartbeatEase((u - a[0]) / (b[0] - a[0])));
  }
  return 0;
}

// Working, as on acirabrowser.com since 22 Oct: a diamond blooms from the centre, a plus hands over to an ex, and a needle
// sweeps eight directions. The three overlap, each starting while the one before fades, so the grid is almost never dark,
// and the loop runs 1.45x faster (about 5s).
type Spec = { dur: number; ease: (x: number) => number; keys: number[][] };
const diamond: Spec = { dur: 2.2, ease: bezier(.16, 1, .3, 1), keys: [[0, 0], [.1, 1], [.55, .85], [1, 0]] };
const plusX: Spec = { dur: 2.2, ease: bezier(.65, 0, .35, 1), keys: [[0, .08], [.14, 1], [.72, .95], [1, .08]] };
const needle: Spec = { dur: 2.4, ease: x => x, keys: [[0, 0], [.08, 1], [.36, .05], [1, 0]] };
function play(spec: Spec, s: number) {
  const k = spec.keys, u = s / spec.dur;
  if (u <= 0) return k[0][1];
  if (u >= 1) return k[k.length - 1][1];
  for (let i = 1; i < k.length; i++) if (u <= k[i][0]) return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * spec.ease((u - k[i - 1][0]) / (k[i][0] - k[i - 1][0]));
  return k[k.length - 1][1];
}
const wSpeed = 1.45, pPlus = 1.8, pNeedle = 4.3, wAll = 7.3;
function working(t: number, r: number, c: number, R: number, C: number) {
  const n = Math.min(R, C) >> 1, dr = r - (R - 1) / 2, dc = c - (C - 1) / 2, ar = Math.abs(dr), ac = Math.abs(dc);
  const u = ((t * wSpeed % wAll) + wAll) % wAll, onPlus = !dr || !dc, onX = ar === ac;
  let v = play(diamond, u - (ar + ac) * .733 / (2 * n));
  const up = u - pPlus;
  if (up > 0) v = Math.max(v, onPlus ? play(plusX, up) : onX ? play(plusX, up - 1.1) : 0);
  const un = u - pNeedle;
  if (un > 0 && (onPlus || onX)) {
    const direction = Math.round(((Math.atan2(dc, -dr) / (Math.PI / 4)) + 8) % 8) % 8;
    v = Math.max(v, !dr && !dc ? play(needle, un) : play(needle, un - direction * .3));
  }
  return v;
}

const presets: Record<MatrixPreset, (t: number, r: number, c: number, R: number, C: number, progress: number) => number> = {
  loader: working,
  heartbeat,
  weave: (t, r, c, R, C) => { const head = (t * 9) % (R * C + 6), d = head - (r * C + (r % 2 ? C - 1 - c : c)); return d >= 0 && d < 1 ? 1 : d >= 1 && d < 4 ? .5 : 0; },
  pulse: (t, r, c, R, C) => Math.pow(Math.max(0, Math.sin(Math.hypot(c - (C - 1) / 2, r - (R - 1) / 2) * 1.4 - t * 3.2)), 3),
  idle: (t, r, c, R, C) => Math.hypot(c - (C - 1) / 2, r - (R - 1) / 2) < 1.2 ? .2 + .55 * (.5 + .5 * Math.sin(t * 1.6)) : 0,
  scan: (t, r, c, R, C) => { const pos = (t * 7) % (C + R * .6 + 6) - 3; return Math.max(0, 1 - Math.abs((c + r * .6) - pos) / 1.8); },
  bars: (t, r, c, R) => (R - 1 - r) < Math.max(1, Math.round((.45 + .3 * Math.sin(t * 3.3 + c * .9) + .2 * Math.sin(t * 6.1 + c * 2.1)) * R)) ? 1 : 0,
  // Paused: a pause glyph that breathes slowly, dimming from the edges in.
  still: (t, r, c, R, C) => {
    const dx = Math.abs(c - (C - 1) / 2), dy = Math.abs(r - (R - 1) / 2);
    const bar = C >= 13 ? dx >= Math.round(C * .1) && dx < Math.round(C * .1) + Math.round(C * .14) && dy <= Math.round(R * .28) : dx >= 1 && dx <= (C >= 9 ? 2.5 : 1) && dy <= (R >= 9 ? 2 : 1.5);
    if (!bar) return 0;
    const f = (t / 2.4) % 1, edge = dy / Math.max(1, (R - 1) / 2);
    return f > .62 && f < .9 && edge >= (.9 - f) * 3 ? .5 : 1;
  },
  off: switchedOff,
  // Tor: the square layers fill with real bootstrap progress, then a layer ripples outward while connected.
  torConnecting,
  // Any real progress (an update downloading): the same fill, from the centre outwards, dot by dot, with the next dot blinking.
  progress: torConnecting,
  // A paused update download: the same fill, held still.
  progressHeld,
  tor: torConnected,
  torStopped,
  // Private: a diagonal sweep that leaves the grid dark behind it.
  private: privateSweep,
  // Added: a check stroke lit on the full grid; the loader cross-fades into it, dot by dot.
  check: (_t, r, c, R, C) => checkLights(r, c, R, C),
  // Playing sound (R4-30): equaliser columns, each at its own pace. Electron reports audible yes/no, so it is animated, not measured.
  audio: audioBars,
  // Downloading: the grid fills from the bottom with the real share received while lights fall onto the surface; held while paused.
  download: (t, r, c, R, C, progress) => downloadFill(t, r, c, R, C, progress),
  downloadHeld: (t, r, c, R, C, progress) => downloadFill(t, r, c, R, C, progress, true),
};
// Heartbeat and the loader keep their smooth opacity curves; the rest use two intensities, full or half.
const smooth = (preset: MatrixPreset) => preset === 'heartbeat' || preset === 'loader' || preset === 'off';
// Shapes that hold still once drawn; they only repaint while cross-fading in or when the appearance changes.
const steady = (preset: MatrixPreset) => preset === 'off' || preset === 'torStopped' || preset === 'check' || preset === 'downloadHeld' || preset === 'progressHeld';
const FADE = .45;
type Painted = { values: number[]; drawn: number[]; R: number; C: number };
const level = (value: number) => value >= .55 ? 1 : value >= .18 ? .5 : 0;
/** A representative resting frame for reduced motion: the loader's full diamond, heartbeat's beat, the solid pause glyph,
 * Tor's centre layer, the private sweep across the middle diagonal. */
const restingTime: Partial<Record<MatrixPreset, number>> = { loader: .6, heartbeat: .4, still: 0, tor: .3, torConnecting: 0, private: 1.2, audio: 47.1, download: .7 };

// One animation loop serves every visible matrix in the window.
// A painter that returns true has drawn its last frame (a steady shape that has settled) and leaves the loop: with nothing left to paint, no timer or frame runs at all.
const painters = new Set<(t: number) => boolean | void>();
let frame = 0;
// A page that never finishes loading keeps its tab's dots going for as long as the tab is open: painted at about 30 per second and woken by a timer ahead of the frame, not at every display frame (75 a second on this display), they read the same
// and neither the page nor the compositor is asked for the frames in between.
let lastPaint = 0, running = false;
const GAP_MS = 32, EARLY_MS = 24;
const loop = (now: number) => {
  // A hidden or minimised window paints nothing (the frame callback is throttled there anyway; this is the explicit stop).
  if (now - lastPaint >= GAP_MS - 4 && !document.hidden) { lastPaint = now; for (const paint of [...painters]) if (paint(now / 1000) === true) painters.delete(paint); }
  frame = 0;
  if (painters.size) wake(); else running = false;
};
const wake = () => { frame = window.setTimeout(() => { frame = requestAnimationFrame(loop); }, EARLY_MS); };
const join = (paint: (t: number) => boolean | void) => { painters.add(paint); if (!running) { running = true; frame = requestAnimationFrame(loop); } return () => { painters.delete(paint); }; };

/** Crisp mode (R4-30/R4-38): square dots of whole device pixels on whole-pixel cells, no unlit grid behind them, so a tiny matrix
 * (the sound equaliser) is sharp at 100%, 150% and 200% instead of soft round dots: [dot, gap] in device pixels per scale. */
export const crispSpec = (dpr: number) => dpr < 1.25 ? [2, 1] : dpr < 1.75 ? [3, 2] : [4, 2];

export function DotMatrix({ preset = 'loader', size = 16, width, height, snap = false, rows, cols, tone = 'ink', reducedMotion = false, label, className = '', progress = 0, state, bare = false }: {
  preset?: MatrixPreset; size?: number; /** A non-square canvas (the audio meter): the grid stays square-celled and centred in it. */ width?: number; height?: number;
  /** Crisp mode: the canvas is exactly the grid (its CSS size follows the screen's pixel density), dots are square and pixel-aligned. */ snap?: boolean;
  /** No unlit grid behind the lights: only the lit dots are drawn. */ bare?: boolean;
  rows?: number; cols?: number; tone?: MatrixTone; reducedMotion?: boolean; label?: string; className?: string;
  /** Real progress, 0–1, for the patterns that show it (torConnecting); each step cross-fades its new dots in. */ progress?: number;
  /** Passed through as data-state for the owner's styling (Tor's error ink). */ state?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), painted = useRef<Painted | null>(null);
  // The site uses 5x5 for inline icons and 7x7 for larger state marks.
  const R = rows ?? (size >= 24 ? 7 : 5), C = cols ?? R, step = Math.round(Math.min(1, Math.max(0, progress)) * 100) / 100;
  const density = snap && typeof devicePixelRatio === 'number' ? Math.max(1, devicePixelRatio) : 1, [dotPx, gapPx] = crispSpec(density);
  const gridW = C * (dotPx + gapPx) - gapPx, gridH = R * (dotPx + gapPx) - gapPx;
  useEffect(() => {
    const node = canvas.current, context = node?.getContext('2d');
    if (!node || !context) return;
    const scale = Math.max(2, devicePixelRatio || 1), fn = presets[preset], raw = smooth(preset);
    // Lights take the surrounding text color (ink, soft) or the finish accent, so they read on light, dark and every
    // finish. Re-read now and then so an appearance change reaches running lights.
    let [on, off] = toneColors(tone, '', ''), read = 0;
    const accent = (t: number) => {
      if (t - read < 1) return;
      read = t; const style = getComputedStyle(node);
      [on, off] = toneColors(tone, style.color, style.getPropertyValue('--ed-blue'));
    };
    if (snap) { node.width = gridW; node.height = gridH; } else { node.width = Math.round((width ?? size) * scale); node.height = Math.round((height ?? size) * scale); }
    const cell = snap ? dotPx + gapPx : Math.min(node.width / C, node.height / R), radius = cell * .35;
    const ox = (node.width - cell * C) / 2, oy = (node.height - cell * R) / 2;
    // A change of state cross-fades from the last frame shown, dot by dot; the first frame of a matrix just appears.
    const last = painted.current, from = !reducedMotion && last && last.R === R && last.C === C ? last : null, start = performance.now() / 1000;
    let settled = false;
    const paint = (t: number): boolean | void => {
      const p = from ? Math.min(1, (t - start) / FADE) : 1;
      if (settled && steady(preset)) return true;
      accent(t);
      context.clearRect(0, 0, node.width, node.height);
      const values: number[] = [], drawn: number[] = [];
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const i = r * C + c, x = ox + cell * (c + .5), y = oy + cell * (r + .5), v = fn(t, r, c, R, C, step), shown = v < 0 ? 0 : 1;
        let value = shown ? (raw ? clamp(v, 0, 1) : level(v)) : 0, dot = shown;
        if (from && p < 1) { value = blend(from.values[i], value, p); dot = blend(from.drawn[i], shown, p); }
        values.push(value); drawn.push(dot);
        if (snap) { if (value) { context.globalAlpha = value; context.fillStyle = on; context.fillRect(c * cell, r * cell, dotPx, dotPx); } continue; }
        if (dot && !bare) { context.globalAlpha = dot; context.fillStyle = off; context.beginPath(); context.arc(x, y, radius, 0, TAU); context.fill(); }
        if (value) { context.globalAlpha = value; context.fillStyle = on; context.beginPath(); context.arc(x, y, radius, 0, TAU); context.fill(); }
      }
      context.globalAlpha = 1;
      painted.current = { values, drawn, R, C };
      settled = p >= 1;
      return settled && steady(preset);
    };
    read = -Infinity; paint(reducedMotion ? restingTime[preset] ?? .6 : start);
    // Still lights repaint when the appearance changes; moving lights pick it up in their loop.
    let leave = () => {}, visible = false;
    // A steady shape that left the loop rejoins it for an appearance change, to repaint in the new colours.
    const themed = new MutationObserver(() => { read = -Infinity; settled = false; if (reducedMotion) paint(restingTime[preset] ?? .6); else if (visible) { leave(); leave = join(paint); } });
    const app = node.closest('.app'); if (app) themed.observe(app, { attributes: true, attributeFilter: ['style', 'class', 'data-theme', 'data-finish'] });
    if (reducedMotion) return () => themed.disconnect();
    const observer = new IntersectionObserver(([entry]) => { leave(); visible = Boolean(entry?.isIntersecting); leave = visible ? join(paint) : () => {}; });
    observer.observe(node);
    return () => { observer.disconnect(); themed.disconnect(); leave(); };
  }, [preset, size, width, height, snap, dotPx, gapPx, R, C, tone, reducedMotion, step, bare]);
  return <canvas ref={canvas} className={`dot-matrix ${className}`} style={snap ? { width: gridW / density, height: gridH / density } : { width: width ?? size, height: height ?? size }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-preset={preset} data-state={state} />;
}
