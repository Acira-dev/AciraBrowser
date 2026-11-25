/** The now-playing card's motion maths (Beta 14), kept free of the window so it can be tested: the card's height curve for opening
 * and folding. (The glow's maths is nowPlayingAura.ts.) */

// ── Opening and folding ───────────────────────────────────────────────────────────────────────────────────────────────────
interface Stop { v: number; p: number }
function stopsOf(easing: string): Stop[] | null {
  const m = /^linear\((.*)\)$/.exec(easing); if (!m) return null;
  const raw = m[1].split(',').map(s => s.trim().split(/\s+/)), n = raw.length;
  return raw.map((s, i) => ({ v: Number(s[0]), p: s[1] ? Number.parseFloat(s[1]) / 100 : i / (n - 1) }));
}
/** The house spring stops sampling just short of 1 and then jumps to it: on a 74 px height that last jump was a whole device
 * pixel. The tail is bent so it lands exactly: every stop moves up by (1 - last) x p^3, zero at the start and the full gap at the end. */
export function landed(easing: string): string {
  const m = /^linear\((.*)\)$/.exec(easing); if (!m) return easing;
  const stops = m[1].split(',').map(s => s.trim().split(/\s+/)), n = stops.length; if (n < 3) return easing;
  const gap = 1 - Number(stops[n - 2][0]); if (!(Math.abs(gap) > 0)) return easing;
  return `linear(${stops.map((s, i) => { if (i === 0 || i === n - 1) return s.join(' '); const p = s[1] ? Number.parseFloat(s[1]) / 100 : i / (n - 1); return `${(Number(s[0]) + gap * p * p * p).toFixed(5)} ${s[1] ?? ''}`.trim(); }).join(', ')})`;
}
/** The card's height moves the whole card (the block is anchored to the sidebar's bottom) and layout lands on whole device
 * pixels: in a spring's slow tail the last pixel crossing came two frames after the motion had visibly stopped, a 1 px tick.
 * So the height runs on its own frame-sampled curve: the spring, but never slower than .55 device px per frame, so the last
 * pixels are crossed while it is still visibly moving and it lands on the frame the motion ends. Played backwards it is the same curve. */
export function heightCurve(easing: string, duration: number, travelPx: number, dpr = 1): { easing: string; duration: number } {
  const pts = stopsOf(easing); if (!pts || !(travelPx > 0)) return { easing, duration };
  const at = (p: number) => { for (let i = 1; i < pts.length; i++) if (p <= pts[i].p) { const a = pts[i - 1], b = pts[i], k = b.p > a.p ? (p - a.p) / (b.p - a.p) : 1; return a.v + (b.v - a.v) * k; } return 1; };
  const frames = Math.max(2, Math.round(duration / (1000 / 60))), minStep = .55 / (travelPx * Math.max(1, dpr)), values = [0];
  for (let k = 1; k <= frames && values[values.length - 1] < 1; k++) values.push(Math.min(1, Math.max(at(k / frames), values[k - 1] + minStep)));
  values[values.length - 1] = 1;
  return { easing: `linear(${values.map(v => v.toFixed(5)).join(', ')})`, duration: (values.length - 1) * 1000 / 60 };
}
