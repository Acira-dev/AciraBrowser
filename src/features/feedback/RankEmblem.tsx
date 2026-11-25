import {useId,useLayoutEffect,useRef,type CSSProperties} from 'react';
import {EMBLEM_GRID,emblemFor,type Emblem,type EmblemDirection,type EmblemRank} from './rankEmblems';
import './rank-emblem.css';

/** One rank emblem (Beta 14/E5, proposal, shown only when the feedback view names a direction; otherwise the quiet dots stay). The drawing is plain data (rankEmblems.ts); this draws it as an SVG,
 * with the rank's colour (the OPEN ring colour: `--acira-rank-ring-<rank>`, the accent until it is set) for the line and the aura, and plays the line-draw when it appears: the lines draw one after
 * another, the body tints and the lit points come in after them, the aura swells and settles. The settled frame is the resting markup itself (nothing is left animating), so the last animated frame
 * and the resting one are the same pixels. Motion set to Off (or the system's reduced motion) shows the settled emblem at once. */
const LINE_PX = 1.45;   // the emblem's own line, in CSS px at every size (the website's hero line is 1.4); the grid only sets the coordinates
export const EMBLEM_DRAW = {stroke: 440, gap: 90, settle: 280, bloom: 900, cut: 240, cutGap: 10, ease: 'cubic-bezier(.45,0,.2,1)', soft: 'cubic-bezier(.3,0,.2,1)'} as const;

const mix = (percent: number): string => `color-mix(in srgb,var(--re-color) ${Math.round(percent * 1000) / 10}%,transparent)`;
/** The aura's paint: radial gradients that fall to nothing well inside the box, one colour and a near-white core (the same recipe as the aura layer, desktop/feedback/aura-page.cjs). */
export function auraPaint(aura: NonNullable<Emblem['aura']>): CSSProperties {
  const p = aura.peak, white = (a: number) => `color-mix(in srgb,color-mix(in srgb,var(--re-color) 20%,white) ${Math.round(a * 1000) / 10}%,transparent)`;   // a near-white that keeps a trace of the colour
  const layers = [
    `radial-gradient(circle closest-side,${white(aura.core)} 0%,${white(aura.core * 0.45)} 22%,${white(0)} 46%)`,
    `radial-gradient(circle closest-side,${mix(p)} 0%,${mix(p * 0.82)} 24%,${mix(p * 0.52)} 48%,${mix(p * 0.24)} 70%,${mix(p * 0.07)} 87%,${mix(0)} 100%)`,
  ];
  return {backgroundImage: layers.join(',')};
}

/** The engraving's angle is the slant of the mark's bands (about 31.7 degrees); its lines are parallel hairlines covering the whole grid, one path each (so each is cut in turn), clipped to the bodies. */
const SLANT = 31.7 * Math.PI / 180;
export function hatchLines(spacing: number): string[] {
  const step = spacing / Math.cos(SLANT), t = Math.tan(SLANT), lines: string[] = [];
  for (let c = -EMBLEM_GRID * t - step; c < EMBLEM_GRID + step; c += step) lines.push(`M0 ${Math.round(c * 100) / 100}L${EMBLEM_GRID} ${Math.round((c + EMBLEM_GRID * t) * 100) / 100}`);
  return lines;
}
/** The band of light that lies across the engraving: a gradient across the slant, centred a little above the middle of the mark. */
const SHEEN = (() => { const n = [-Math.sin(SLANT), Math.cos(SLANT)], cx = 24, cy = 20, h = 8; return {x1: Math.round((cx - n[0] * h) * 100) / 100, y1: Math.round((cy - n[1] * h) * 100) / 100, x2: Math.round((cx + n[0] * h) * 100) / 100, y2: Math.round((cy + n[1] * h) * 100) / 100}; })();

export interface RankEmblemProps {
  direction: EmblemDirection;
  rank: EmblemRank;
  /** The emblem's own box, in CSS px. */
  size: number;
  /** Play the line-draw when it appears (the default). False: just the settled emblem. */
  draw?: boolean;
  /** ms to wait before the first line (the pop-up's own reveal comes first). */
  delay?: number;
  className?: string;
  /** The most the aura may spread (in emblem sizes), for an emblem near the edge of its pop-up. */
  maxSpread?: number;
}

/** The pace the interface runs set-length motion at (the line-draw is one: it has a length of its own that Premium never stretches): 1 in Premium, .5 in Fast (`--motion-pace`, written on `.app` by App), and 0,
 * nothing played, when motion is Off (`--motion-scale` 0: the setting, Accessibility's Reduce motion or the system's) . */
function paceOf(element: Element): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 1;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const app = getComputedStyle(element.closest('.app') ?? document.documentElement);
  const scale = Number.parseFloat(app.getPropertyValue('--motion-scale')), pace = Number.parseFloat(app.getPropertyValue('--motion-pace'));
  if (Number.isFinite(scale) && scale <= 0) return 0;
  return Number.isFinite(pace) && pace > 0 ? pace : 1;
}

/** Plays the draw-in on one mounted emblem; returns a stopper. The restful state is what the stylesheet gives, so every animation ends exactly there (fill 'backwards' only holds the start). */
export function playEmblem(root: HTMLElement, delay = 0): () => void {
  const pace = paceOf(root);
  if (pace <= 0 || typeof root.animate !== 'function') return () => {};
  const animations: Animation[] = [];
  const run = (target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): void => { animations.push(target.animate(keyframes, {fill: 'backwards', ...options})); };
  let clock = delay;
  const lines = [...root.querySelectorAll<SVGPathElement>('.re-stroke')];
  for (const path of lines) {
    run(path, [{strokeDasharray: '1 2', strokeDashoffset: 1.01}, {strokeDasharray: '1 2', strokeDashoffset: 0}], {duration: EMBLEM_DRAW.stroke * pace, delay: clock * 1, easing: EMBLEM_DRAW.ease});
    clock += ((path.dataset.ghost !== undefined ? EMBLEM_DRAW.stroke * 0.3 : EMBLEM_DRAW.stroke * 0.55) + EMBLEM_DRAW.gap) * pace;
  }
  const after = clock + EMBLEM_DRAW.stroke * 0.45 * pace;
  /* The tints, the lit points and the engraving come in by their own paint opacity (fill-opacity / stroke-opacity), not by a group opacity: a group opacity paints the element in a layer of its own while it
     runs and straight into the picture when it is done, and the two do not round alike (up to 25 levels on the edges), which would show as a flicker at the very end of the draw-in. */
  const fade = (target: Element, property: 'fillOpacity' | 'strokeOpacity', duration: number, at = after): void => { const rest = getComputedStyle(target)[property]; run(target, [{[property]: 0}, {[property]: rest}], {duration: duration * pace, delay: at, easing: EMBLEM_DRAW.soft}); };
  for (const body of root.querySelectorAll('.re-body')) fade(body, body.getAttribute('fill') === 'none' ? 'strokeOpacity' : 'fillOpacity', EMBLEM_DRAW.settle);
  for (const light of root.querySelectorAll('.re-light circle')) fade(light, 'fillOpacity', EMBLEM_DRAW.settle);
  /* The engraving is cut line by line (each hairline is drawn like the strokes are), then the light comes to lie across it. */
  const cuts = [...root.querySelectorAll('.re-hatch path')];
  cuts.forEach((cut, index) => run(cut, [{strokeDasharray: '1 2', strokeDashoffset: 1.01}, {strokeDasharray: '1 2', strokeDashoffset: 0}], {duration: EMBLEM_DRAW.cut * pace, delay: after + index * EMBLEM_DRAW.cutGap * pace, easing: EMBLEM_DRAW.ease}));
  const sheen = root.querySelector('.re-sheen');
  if (sheen) fade(sheen, 'fillOpacity', EMBLEM_DRAW.bloom * 0.7, after + (cuts.length * EMBLEM_DRAW.cutGap + EMBLEM_DRAW.cut * 0.5) * pace);
  const aura = root.querySelector('.re-aura'), bloom = root.querySelector('.re-bloom');
  if (aura) run(aura, [{opacity: 0}, {opacity: 1}], {duration: (EMBLEM_DRAW.bloom * 0.8) * pace, delay: delay + 80 * pace, easing: EMBLEM_DRAW.soft});
  if (bloom) run(bloom, [{opacity: 0}, {opacity: 1, offset: 0.45}, {opacity: 0}], {duration: EMBLEM_DRAW.bloom * pace, delay: delay + 120 * pace, easing: 'linear'});
  return () => { for (const animation of animations) animation.cancel(); };
}

export function RankEmblem({direction, rank, size, draw = true, delay = 0, className, maxSpread}: RankEmblemProps) {
  const emblem = emblemFor(direction, rank), id = useId().replace(/:/g, ''), ref = useRef<HTMLSpanElement>(null);
  /* A small emblem sits close to the edge of its pop-up: its aura is kept inside the room it has, so the light never ends in a cut at the pop-up's edge. */
  const spread = emblem.aura ? Math.min(emblem.aura.spread, maxSpread ?? (size <= 28 ? 0.65 : Infinity)) : 0;
  useLayoutEffect(() => { if (!draw || !ref.current) return undefined; return playEmblem(ref.current, delay); }, [direction, rank, draw, delay]);
  const style = {'--re-size': `${size}px`, '--re-w': `${Math.round(LINE_PX * EMBLEM_GRID / size * 1000) / 1000}`} as CSSProperties;
  return <span ref={ref} className={`re${className ? ' ' + className : ''}`} data-direction={direction} data-rank={rank === 'earlyMember' ? undefined : rank} data-early={rank === 'earlyMember' || undefined} style={style} aria-hidden="true">
    {emblem.aura && <><span className="re-aura" style={{...auraPaint(emblem.aura), '--re-spread': spread} as CSSProperties}/><span className="re-bloom" style={{...auraPaint({...emblem.aura, peak: Math.min(0.5, emblem.aura.peak * 1.9), core: Math.min(0.6, emblem.aura.core * 1.6)}), '--re-spread': spread} as CSSProperties}/></>}
    <svg className="re-svg" viewBox={`0 0 ${EMBLEM_GRID} ${EMBLEM_GRID}`} width={size} height={size} focusable="false">
      {(emblem.lights.length > 0 || emblem.etching) && <defs>
        {emblem.etching && <><clipPath id={`${id}-clip`}>{emblem.etching.clip.map((d, index) => <path key={index} d={d}/>)}</clipPath>
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={SHEEN.x1} y1={SHEEN.y1} x2={SHEEN.x2} y2={SHEEN.y2}><stop offset="0" stopColor="#fff" stopOpacity="0"/><stop offset="0.5" stopColor="#fff" stopOpacity="0.9"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></linearGradient></>}
        {emblem.lights.map((light, index) => <radialGradient key={index} id={`${id}-l${index}`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fff" stopOpacity={light.core}/><stop offset="38%" stopColor="var(--re-color)" stopOpacity={light.core * 0.45}/><stop offset="100%" stopColor="var(--re-color)" stopOpacity="0"/>
      </radialGradient>)}</defs>}
      {emblem.bodies.map((body, index) => body.width
        ? <path key={`b${index}`} className="re-body" d={body.d} fill="none" stroke="var(--re-color)" strokeOpacity={body.opacity} strokeWidth={body.width}/>
        : <path key={`b${index}`} className="re-body" d={body.d} fill="var(--re-color)" fillOpacity={body.opacity} stroke="none"/>)}
      {emblem.etching && <g className="re-etching" clipPath={`url(#${id}-clip)`}>
        <g className="re-hatch" style={{strokeOpacity: emblem.etching.opacity}}>{hatchLines(emblem.etching.spacing).map((d, index) => <path key={index} className="re-hatch-line" d={d} pathLength={1}/>)}</g>
        {emblem.etching.sheen > 0 && <rect className="re-sheen" x="0" y="0" width={EMBLEM_GRID} height={EMBLEM_GRID} fill={`url(#${id}-sheen)`} style={{fillOpacity: emblem.etching.sheen}}/>}
      </g>}
      {emblem.strokes.map((stroke, index) => <path key={`s${index}`} className="re-stroke" data-ghost={stroke.ghost || undefined} d={stroke.d} pathLength={1} style={{opacity: stroke.opacity, '--wm': stroke.weight ?? 1} as CSSProperties}/>)}
      {emblem.lights.map((light, index) => <g key={`l${index}`} className="re-light">
        <circle cx={light.x} cy={light.y} r={light.r * (light.bead ? 3.4 : 1)} fill={`url(#${id}-l${index})`}/>
        {light.bead && <><circle className="re-bead" cx={light.x} cy={light.y} r={light.r}/><circle className="re-bead-core" cx={light.x} cy={light.y} r={light.r * 0.45}/></>}
      </g>)}
    </svg>
  </span>;
}
