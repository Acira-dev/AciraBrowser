// Beta 14: the drawn "14" of the Welcome title. Ported from the reference design's sample (round 12) with every value as it is; only the dead rounds are gone (the other
// compositions, the solid and outline modes, the other fills, the test switches).
//
// What it is: a bold numeral outline, the weight of the title's words, on the title's baseline at its cap height, with a few construction lines around it (the baseline and cap
// rules, the 4's diagonal and stem axis, the side-bearing lines and a mid line, two circles through its key points, two centre crosses). Filled with F1 engineer's section
// hatching, the only fill: 45 degrees, period 4 CSS px, line weight 50 % of the spacing, full ink, square ends clipped to the glyph, laid out in DEVICE pixels (the horizontal
// period is a whole number of device pixels: no moire, no shimmer on resize; rebuilt when the numeral's size changes).
// Draw-in (CSS `k-draw` / `k-sheen`): rules sweep out, circles draw, diagonals extend, the outline traces edge by edge, then the hatch lines draw one after another left to
// right, each from its lower-left end (240 ms per stroke, 540 ms sweep, about 780 ms), then ONE sheen passes over the hatch only (brightness only, 1.3 s). Lines near the pointer
// brighten a little. Exit: everything fades and blurs in place with its word (welcome.css, "the exit"), nothing retracts or moves. Reduced motion: fully drawn, no sheen.
// Units are the numeral's: cap height 100, baseline y 100.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

const ONE = 'M26 0 L41.5 0 L41.5 100 L26 100 L26 17.5 L14.4 26.2 L6 15 Z';
const FOUR = 'M104 0 L119.5 0 L119.5 63 L130 63 L130 77.5 L119.5 77.5 L119.5 100 L104 100 L104 77.5 L52 77.5 L52 63 Z M104 22 L104 63 L70.15 63 Z';
type Line = { x1: number; y1: number; x2: number; y2: number; t: number; dur: number; p?: boolean; f0: number; f1: number };
type Circ = { cx: number; cy: number; r: number; t: number; dur: number; p?: boolean; a0: number; fade: number };
const RULES: Line[] = [
  // drawn from the 14 outward (x1 is the start); the long far end fades out back under the words
  { x1: 150, y1: 100, x2: -520, y2: 100, t: 0, dur: 900, p: true, f0: 0.04, f1: 0.62 },
  { x1: 146, y1: 0, x2: -360, y2: 0, t: 80, dur: 820, f0: 0.05, f1: 0.6 },
];
const SET: { lines: Line[]; circles: Circ[]; marks: [number, number, boolean][] } = {
  lines: [...RULES,
    { x1: 52 - 55 * 0.8254, y1: 118, x2: 104 + 34 * 0.8254, y2: -34, t: 560, dur: 620, p: true, f0: 0.3, f1: 0.3 },   // the 4's diagonal
    { x1: 111.75, y1: -26, x2: 111.75, y2: 124, t: 420, dur: 520, f0: 0.28, f1: 0.28 },                                // the 4's stem axis
    { x1: 6, y1: -20, x2: 6, y2: 120, t: 200, dur: 560, f0: 0.3, f1: 0.3 },                                            // side bearings and the mid line
    { x1: 130, y1: 120, x2: 130, y2: -20, t: 260, dur: 560, f0: 0.3, f1: 0.3 },
    { x1: 152, y1: 50, x2: -16, y2: 50, t: 140, dur: 700, f0: 0.18, f1: 0.22 },
  ],
  circles: [
    { cx: 97.95, cy: 52.14, r: 52.49, t: 360, dur: 1100, p: true, a0: 200, fade: 0.55 },   // circumcircle: apex, crossbar corner, stem foot
    { cx: 26, cy: 17.5, r: 20.16, t: 640, dur: 640, a0: 150, fade: 0.4 },                  // the flag's circle: pivot to tip
  ],
  marks: [[97.95, 52.14, true], [26, 17.5, true]],
};

// The glyph outline is drawn as separate pen strokes, one per edge, each running 2.2 units past both corners (the small overshoot of a drafted corner) and tapering to nothing at
// both ends; traced in contour order.
const POLYS: [number, number][][] = [
  [[26, 0], [41.5, 0], [41.5, 100], [26, 100], [26, 17.5], [14.4, 26.2], [6, 15]],
  [[104, 0], [119.5, 0], [119.5, 63], [130, 63], [130, 77.5], [119.5, 77.5], [119.5, 100], [104, 100], [104, 77.5], [52, 77.5], [52, 63]],
  [[104, 22], [104, 63], [70.15, 63]],
];
const OV = 2.2;
type Edge = { x1: number; y1: number; x2: number; y2: number; t: number; dur: number };
const EDGES: Edge[] = (() => {
  const out: Edge[] = []; const starts = [1250, 1380, 2120], spans = [900, 1050, 360];
  POLYS.forEach((P, pi) => {
    const segs = P.map((a, i) => [a, P[(i + 1) % P.length]] as const), lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])), L = lens.reduce((s, v) => s + v, 0);
    let acc = 0;
    segs.forEach(([a, b], i) => {
      const len = lens[i], ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      // each stroke slightly overlaps the next in time, like one continuous hand
      out.push({ x1: a[0] - ux * OV, y1: a[1] - uy * OV, x2: b[0] + ux * OV, y2: b[1] + uy * OV, t: starts[pi] + (acc / L) * spans[pi], dur: Math.max(120, (len / L) * spans[pi] * 1.35) });
      acc += len;
    });
  });
  return out;
})();
const OUTLINE_END = 2480, FILL_BEAT = 380;
/** F1 engineer's section hatching: the pick (period in CSS px, line weight as a share of the perpendicular spacing, angle in degrees). */
export const HATCH_PICK = Object.freeze({ period: 4, coverage: 0.5, angle: 45 });
const FS = OUTLINE_END + FILL_BEAT;   // ms, before the CSS's own +420 lead
const HATCH_SPAN = 540, HATCH_STROKE = 240;
type FillEl = { d: string; w: number; t: number };
function hatchLines(unitDev: number, dpr: number): FillEl[] {
  const { period, coverage, angle } = HATCH_PICK;
  const pDev = Math.max(3, Math.round(period * dpr));       // whole device pixels
  const pu = pDev / unitDev, th = angle * Math.PI / 180, run = 100 / Math.tan(th);   // horizontal run of a line across the cap height
  const w = coverage * pu * Math.sin(th);                   // perpendicular line weight (units)
  const out: FillEl[] = [];
  for (let x0 = -run - pu; x0 < 136 + pu; x0 += pu) {
    const xm = x0 + run / 2; if (xm + run / 2 < -2 || xm - run / 2 > 138) continue;
    out.push({ d: `M${x0.toFixed(3)} 100 L${(x0 + run).toFixed(3)} 0`, w, t: FS + Math.max(0, Math.min(1, xm / 136)) * HATCH_SPAN });
  }
  return out;
}

export function Sketch14({ reduced = false }: { reduced?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const id = useRef(`k${Math.random().toString(36).slice(2, 7)}`).current;
  // device pixels per numeral unit (the svg's on-screen height / 100 x dpr); the hatch is rebuilt when it changes
  const [unitDev, setUnitDev] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => { const h = el.getBoundingClientRect().height; if (h > 0) setUnitDev(+(h / 100 * (devicePixelRatio || 1)).toFixed(4)); };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); addEventListener('resize', measure);
    return () => { ro.disconnect(); removeEventListener('resize', measure); };
  }, []);
  const els = useMemo(() => (unitDev > 0 ? hatchLines(unitDev, devicePixelRatio || 1) : []), [unitDev]);
  const lastT = els.length ? els[els.length - 1].t : FS;
  const total = 3400;
  const glint = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el || reduced) return;
    const near = (cx: number, cy: number) => {
      const g = glint.current, m = el.getScreenCTM(); if (!g || !m) return;
      const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
      const d = Math.max(0, Math.max(-p.x, p.x - 136, 0) + Math.max(-p.y, p.y - 100, 0));
      g.style.setProperty('--gx', `${p.x.toFixed(1)}px`); g.style.setProperty('--gy', `${p.y.toFixed(1)}px`);
      g.style.setProperty('--go', d < 30 ? (0.9 * (1 - d / 30)).toFixed(2) : '0');
    };
    const mv = (e: PointerEvent) => { el.style.setProperty('--k14-px', ((e.clientX / innerWidth - 0.5) * 2).toFixed(3)); el.style.setProperty('--k14-py', ((e.clientY / innerHeight - 0.5) * 2).toFixed(3)); near(e.clientX, e.clientY); };
    addEventListener('pointermove', mv);
    return () => removeEventListener('pointermove', mv);
  }, [reduced]);
  const tm = (t: number, dur: number): CSSProperties => ({ ['--d' as string]: `${t}ms`, ['--dr' as string]: `${Math.max(0, total - t - dur) * 0.55}ms`, ['--dur' as string]: `${dur}ms` });
  // a full circle starting at a0 (deg), drawn counter-clockwise around its centre
  const circ = (c: Circ) => { const a = c.a0 * Math.PI / 180, P = (b: number) => `${(c.cx + c.r * Math.cos(b)).toFixed(2)} ${(c.cy - c.r * Math.sin(b)).toFixed(2)}`;
    return `M${P(a)} A${c.r} ${c.r} 0 0 0 ${P(a + Math.PI)} A${c.r} ${c.r} 0 0 0 ${P(a + Math.PI * 2 - 0.0001)}`; };
  return (
    <svg ref={ref} className="k14" data-reduced={reduced || undefined} viewBox="0 0 136 100" aria-hidden="true">
      <defs>
        <clipPath id={`${id}clip`}><path className="k-cp" d={`${ONE} ${FOUR}`} clipRule="evenodd" /></clipPath>
        <mask id={`${id}hm`} maskUnits="userSpaceOnUse" x="-10" y="-10" width="156" height="120">
          {els.map((e, i) => <path key={i} className="k-mk" d={e.d} fill="none" stroke="#fff" strokeWidth={e.w} />)}
        </mask>
        <linearGradient id={`${id}sheen`} gradientUnits="userSpaceOnUse" x1="-30" y1="0" x2="30" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity="1" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}glint`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="26">
          <stop offset="0" stopColor="#fff" stopOpacity="1" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {EDGES.map((e, i) => (
          <linearGradient key={'e' + i} id={`${id}e${i}`} gradientUnits="userSpaceOnUse" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}>
            <stop offset="0" stopColor="currentColor" stopOpacity="0" /><stop offset=".09" stopColor="currentColor" stopOpacity="1" />
            <stop offset=".91" stopColor="currentColor" stopOpacity="1" /><stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>))}
        {SET.lines.map((l, i) => (
          <linearGradient key={i} id={`${id}g${i}`} gradientUnits="userSpaceOnUse" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}>
            <stop offset="0" stopColor="currentColor" stopOpacity="0" /><stop offset={l.f0} stopColor="currentColor" stopOpacity="1" />
            <stop offset={1 - l.f1} stopColor="currentColor" stopOpacity="1" /><stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>))}
        {SET.circles.map((c, i) => { const a = (c.a0 + 180) * Math.PI / 180; return (
          // the circle fades on its far side (opposite where the compass starts)
          <linearGradient key={'c' + i} id={`${id}c${i}`} gradientUnits="userSpaceOnUse" x1={c.cx - c.r * Math.cos(a)} y1={c.cy + c.r * Math.sin(a)} x2={c.cx + c.r * Math.cos(a)} y2={c.cy - c.r * Math.sin(a)}>
            <stop offset="0" stopColor="currentColor" stopOpacity="1" /><stop offset={1 - c.fade} stopColor="currentColor" stopOpacity="1" /><stop offset="1" stopColor="currentColor" stopOpacity={c.fade ? 0.05 : 1} />
          </linearGradient>); })}
      </defs>
      <g className="k-guides">
        {SET.lines.map((l, i) => <path key={i} d={`M${l.x1} ${l.y1} L${l.x2} ${l.y2}`} pathLength={1} className={`k-seg k-line ${l.p ? 'k-p' : 'k-s'}`} style={{ ...tm(l.t, l.dur), stroke: `url(#${id}g${i})` }} />)}
        {SET.circles.map((c, i) => <path key={'c' + i} d={circ(c)} pathLength={1} className={`k-seg k-circle ${c.p ? 'k-p' : 'k-s'}`} style={{ ...tm(c.t, c.dur), stroke: `url(#${id}c${i})` }} />)}
        {SET.marks.map(([x, y, acc], i) => <g key={'m' + i} className={`k-mark${acc ? ' k-acc' : ''}`} style={{ ['--d' as string]: `${900 + i * 120}ms` } as CSSProperties}><path className="k-mp" d={`M${x - 4.5} ${y} H${x + 4.5} M${x} ${y - 4.5} V${y + 4.5}`} /></g>)}
      </g>
      <g className="k-glyphs">
        <g className="k-fillset" clipPath={`url(#${id}clip)`}>
          {els.map((e, i) => <path key={i} d={e.d} pathLength={1} className="k-f k-fl" style={{ strokeWidth: e.w, ['--hd' as string]: `${e.t.toFixed(0)}ms`, ['--hr' as string]: `${Math.max(0, lastT - e.t) / HATCH_SPAN * 150}ms` } as CSSProperties} />)}
          {/* light on the hatch only (masked by the lines): one sheen after the hatch completes, and a soft glint near the pointer */}
          <g className="k-light" mask={`url(#${id}hm)`}>
            <rect className="k-sheen" x="-30" y="-10" width="60" height="120" fill={`url(#${id}sheen)`} style={{ ['--sd' as string]: `${(lastT + HATCH_STROKE + 260).toFixed(0)}ms` } as CSSProperties} />
            <g ref={glint} className="k-glint"><circle className="k-gc" r="26" fill={`url(#${id}glint)`} /></g>
          </g>
        </g>
        {EDGES.map((e, i) => <path key={'o' + i} d={`M${e.x1.toFixed(2)} ${e.y1.toFixed(2)} L${e.x2.toFixed(2)} ${e.y2.toFixed(2)}`} pathLength={1} className="k-seg k-edge" style={{ ...tm(e.t, e.dur), stroke: `url(#${id}e${i})` }} />)}
      </g>
    </svg>
  );
}
