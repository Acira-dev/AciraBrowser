import { blockSlideOf, type BlockSlide } from './addressInSidebar';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { springAt, springEasing, springs, type SpringSpec } from './springs';
import { classScale, frequentStretch, kick, motionPaceOf, springFor, springForFrequent, stripMs, type MotionClass, type MotionTokenId, type SpeedName } from './motionTokens';
import { atRest, disclosureFrames, glideAt, glideStart, negligible, planList, type Glide, type GlideState } from './morphPlan';
export * from './springs';
export * from './motionTokens';

/** Shared motion primitives (A, round 2; bible §3.9 and §4 "One motion"). Lists, page sections and mode switches plug
 * into these so motion is one system: it starts on the frame of the change, stays quick, animates transform and
 * opacity only (compositor), and never hard-cuts or waits. The animation-speed setting (below) stretches every one of
 * them; Off turns them off. */

/** Above this many rows a list change fades the list once instead of moving each row. */
const rowCap = 150;

export function reducedMotion(): boolean {
  if (typeof document === 'undefined') return true;
  return !!document.querySelector('.app[data-reduced-motion="true"]') || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The animation-speed setting (R3-17; Settings › Appearance). Premium is the default: relaxed, every stage visible
 * (1.7× the base durations, which are the durations before the setting existed). Fast is snappy: 0.6× the base. Off is
 * instant. The OS asking for reduced motion always wins, and so does Accessibility › Reduce motion: both mean Off. */
export type AnimationSpeed = SpeedName;
/** The spatial (S) multiplier of each speed: this is `--motion-scale`. Effects (E) take 1.4 in Premium and 0.6 in Fast, and
 * latency-bound motion (L: press, hover, drag follow) stays 1: `--motion-e`, `--motion-l`, `motionScale('E')`. */
export const motionScales: Record<AnimationSpeed, number> = { premium: 1.7, fast: .6, off: 0 };
/** The effective speed for a settings object whose `reducedMotion` already includes the OS preference (App merges it). */
export function animationSpeedOf(settings: { animationSpeed?: string; reducedMotion?: boolean } | null | undefined): AnimationSpeed {
  if (settings?.reducedMotion) return 'off';
  return settings?.animationSpeed === 'fast' ? 'fast' : 'premium';
}
export const motionScaleOf = (settings: Parameters<typeof animationSpeedOf>[0]): number => motionScales[animationSpeedOf(settings)];

let currentSpeed: SpeedName | null = null;
/** App publishes the effective speed here and as CSS: `--motion-scale` (= `--motion-s`, the spatial class) on `.app` and
 * the document root, plus `--motion-e`, `--motion-l` and `--motion-pace`, so script and CSS read one source. */
export function publishMotionSpeed(speed: SpeedName): void {
  currentSpeed = speed;
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  style.setProperty('--motion-scale', String(classScale(speed, 'S')));
  style.setProperty('--motion-s', String(classScale(speed, 'S')));
  style.setProperty('--motion-e', String(classScale(speed, 'E')));
  style.setProperty('--motion-l', String(classScale(speed, 'L')));
  // Frequent surfaces (tab strips, sidebar rows, suggestions) take 40% of the stretch: `--motion-f` (1.28 Premium, .6 Fast, 0 Off).
  style.setProperty('--motion-f', String(frequentStretch(classScale(speed, 'S'))));
  // Motion with a set length that Premium never stretches quickens in Fast: `--motion-pace` (1 Premium, .5 Fast, 1 Off).
  style.setProperty('--motion-pace', String(motionPaceOf(speed)));
}
/** The speed in force right now: Off whenever reduced motion is on (the setting or the OS). Before App has published one,
 * it is Fast. */
export function motionSpeed(): SpeedName {
  if (typeof document === 'undefined' || reducedMotion()) return 'off';
  return currentSpeed ?? 'fast';
}
/** The multiplier a duration reads: for the spatial class 1.7 Premium, .6 Fast, 0 Off (`--motion-scale`); effects 1.4 and
 * latency-bound 1 in Premium. */
export function motionScale(cls: MotionClass = 'S'): number {
  return classScale(motionSpeed(), cls);
}
/** The spring-speed multiplier of a frequent surface that still runs a hand-tuned spring (the tab strips): 1/.6 in Fast (the
 * same spring, stiffer), 1/1.28 in Premium (28% slower), 1 when off (those surfaces then run no motion). */
export const frequentSpeed = (settings: Parameters<typeof animationSpeedOf>[0]): number => { const scale = classScale(animationSpeedOf(settings), 'S'); return scale > 0 ? 1 / frequentStretch(scale) : 1; };
/** The pace of motion with a set length that Premium never stretches (`motionPaceOf`): .5 in Fast, 1 otherwise. */
export const motionPace = (): number => motionPaceOf(motionSpeed());
/** Milliseconds for the current speed: `scaled(180)` is 306 in Premium, 108 in Fast, 0 when off. */
export const scaled = (ms: number, cls: MotionClass = 'S'): number => ms * motionScale(cls);
/** Frequent and keyboard-opened surfaces (right-click menus, the palette) take only part of the Premium stretch: a
 * surface used a hundred times a day must never feel slow. */
export const frequentScale = (scale = motionScale()): number => frequentStretch(scale);

/** Animate with a spring on the compositor (transform/opacity keyframes). Returns null when motion is off, so callers
 * can place the element at its end state. The element ends at the last keyframe (`fill: both`). */
export function animateSpring(el: Element, keyframes: Keyframe[], spec: SpringSpec | MotionTokenId = springs.settle, options: KeyframeAnimationOptions = {}, opening = false): Animation | null {
  const speed = motionSpeed(); if (speed === 'off') return null;
  const token = typeof spec === 'string', resolved = token ? springFor(spec, speed) : spec; if (!resolved) return null;
  // A token already carries its class multiplier; a bare spec is stretched by the spatial scale. An opening spring gets its
  // launch velocity (the "kick"), so its first painted frame is already moving.
  const scale = token ? 1 : motionScale(), velocity = opening ? kick[speed] * (Math.PI * 2) / (resolved.duration * scale) : 0;
  const { duration, easing } = springEasing(resolved, scale, velocity);
  return el.animate(keyframes, { duration, easing, fill: 'both', ...options });
}

/** Morph an element from another element's box to its own (a tab chip becoming its group, a trigger becoming its menu, a
 * pane forming): FLIP with translate and scale on the spring, the origin at the top-left. The box stretches a little
 * non-uniformly on the way, which is the squash and stretch; put text in a child that fades in (never scale text). Returns
 * null when motion is off. Pass `to` when the element's final box is already known. */
export function morphFromRect(el: HTMLElement, from: DOMRect, spec: SpringSpec = springs.morph, to: DOMRect = el.getBoundingClientRect()): Animation | null {
  if (!motionScale() || !to.width || !to.height) return null;
  el.style.transformOrigin = '0 0';
  const animation = animateSpring(el, [{ translate: `${from.left - to.left}px ${from.top - to.top}px`, scale: `${from.width / to.width} ${from.height / to.height}` }, { translate: '0 0', scale: '1 1' }], spec, { fill: 'backwards' });
  animation?.finished.then(() => { el.style.transformOrigin = ''; }, () => { el.style.transformOrigin = ''; });
  return animation;
}

/** A morph target for `springTo`: translate in px, a uniform scale, and opacity. Omitted properties stay where they are. */
export interface MorphTarget { x?: number; y?: number; scale?: number; opacity?: number }
type MorphAxis = 'translate' | 'scale' | 'opacity';
interface Flight { spec: SpringSpec; scale: number; startedAt: number; from: number[]; to: number[]; velocity: number[]; animation: Animation }
const flights = new WeakMap<Element, Partial<Record<MorphAxis, Flight>>>();
const rests = new WeakMap<Element, { translate: number[]; scale: number[]; opacity: number[] }>();
const flightValue = (f: Flight, now: number) => {
  const stretched = { duration: f.spec.duration * f.scale, bounce: f.spec.bounce }, t = Math.max(0, (now - f.startedAt) / 1000);
  const states = f.from.map((from, i) => springAt(stretched, from, f.to[i], t, f.velocity[i]));
  return { value: states.map(s => s.value), velocity: states.map(s => s.velocity) };
};
const css = (axis: MorphAxis, v: number[]) => axis === 'translate' ? `${v[0]}px ${v[1]}px` : String(v[0]);

/** Move an element to a target on the spring, from wherever it is now. Interrupting a morph in flight (a toast leaving
 * while it is still arriving, a list swapped twice in a row) retargets it: the new spring starts at the position and
 * velocity the old one had, as SwiftUI does, so nothing stops dead or jumps. Animates the individual transform
 * properties (`translate`, `scale`) and `opacity`, all compositor-only. Motion off: the element is placed at once. */
export function springTo(el: HTMLElement, to: MorphTarget, specOrToken: SpringSpec | MotionTokenId = springs.settle, options: { from?: MorphTarget } = {}): Promise<void> {
  const speed = motionSpeed(), token = typeof specOrToken === "string", spec: SpringSpec = (token ? springFor(specOrToken, speed) : specOrToken) ?? springs.settle, scale = speed === "off" ? 0 : token ? 1 : motionScale(), now = performance.now(), live = flights.get(el) ?? {}, rest = rests.get(el) ?? { translate: [0, 0], scale: [1], opacity: [Number.parseFloat(getComputedStyle(el).opacity) || 0] };
  const request: Record<MorphAxis, number[] | undefined> = {
    translate: to.x === undefined && to.y === undefined ? undefined : [to.x ?? rest.translate[0], to.y ?? rest.translate[1]],
    scale: to.scale === undefined ? undefined : [to.scale],
    opacity: to.opacity === undefined ? undefined : [to.opacity],
  };
  const start: Record<MorphAxis, number[] | undefined> = {
    translate: options.from && (options.from.x !== undefined || options.from.y !== undefined) ? [options.from.x ?? rest.translate[0], options.from.y ?? rest.translate[1]] : undefined,
    scale: options.from?.scale === undefined ? undefined : [options.from.scale],
    opacity: options.from?.opacity === undefined ? undefined : [options.from.opacity],
  };
  const done: Promise<unknown>[] = [];
  for (const axis of ['translate', 'scale', 'opacity'] as const) {
    const target = request[axis]; if (!target) continue;
    const running = live[axis], current = running ? flightValue(running, now) : undefined;
    running?.animation.cancel();
    const from = start[axis] ?? current?.value ?? rest[axis], velocity = start[axis] ? from.map(() => 0) : current?.velocity ?? from.map(() => 0);
    rest[axis] = target;
    if (!scale) { delete live[axis]; el.style[axis] = css(axis, target); continue; }
    const travel = target.map((x, i) => x - from[i]), size = travel.reduce((s, x) => s + x * x, 0);
    // Progress is shared by every component of the vector, so the incoming velocity is projected onto the new direction.
    const unitVelocity = size > 1e-9 ? travel.reduce((s, x, i) => s + x * velocity[i], 0) / size : 0;
    const { duration, easing } = springEasing(spec, scale, unitVelocity);
    el.style[axis] = css(axis, from);
    const animation = el.animate({ [axis]: [css(axis, from), css(axis, target)] }, { duration, easing, fill: 'none' });
    live[axis] = { spec, scale, startedAt: now, from, to: target, velocity, animation };
    el.style[axis] = css(axis, target);
    done.push(animation.finished.then(() => { if (live[axis]?.animation === animation) delete live[axis]; }, () => {}));
  }
  flights.set(el, live); rests.set(el, rest);
  return Promise.all(done).then(() => undefined);
}

interface Place { x: number; y: number; w: number; h: number; row?: boolean }
const placeIn = (host: HTMLElement, hostBox: DOMRect, el: Element): Place => {
  const r = el.getBoundingClientRect();
  return { x: r.left - hostBox.left + host.scrollLeft, y: r.top - hostBox.top + host.scrollTop, w: r.width, h: r.height };
};

/** Animate on a resolved spring (a token's spring already carries its class stretch). The element ends at the last
 * keyframe. Null when there is no spring (motion is off). */
export function playSpring(el: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, spec: SpringSpec | null, options: KeyframeAnimationOptions = {}): Animation | null {
  if (!spec) return null;
  const { duration, easing } = springEasing(spec, 1);
  return el.animate(keyframes, { duration, easing, fill: 'both', ...options });
}
/** The spring of a token for the speed in force; a frequent surface takes part of the Premium stretch. */
export const springNow = (token: MotionTokenId, frequent = false): SpringSpec | null => (frequent ? springForFrequent : springFor)(token, motionSpeed());

/** Seconds the strip's width spring takes (`stripMs`, 40% of the Premium stretch; 0 when off), as `--tab-duration` in CSS. */
export const stripSeconds = (speed: SpeedName = motionSpeed()): number => stripMs / 1000 * frequentStretch(classScale(speed, 'S'));
/** A framer-motion `exit` for something leaving a tab strip (a closed tab, a split's chip after Unsplit): its content fades
 * first, on the effects timing (`fade`, E class), while its room closes on the strip's width spring, and it stays mounted until
 * that room is closed, so nothing next to it jumps when it unmounts (the old fixed 0.5 s exit left a ghost for half a second and,
 * in Premium, unmounted 0.1 s before the room had closed). Off: gone at once. */
export function stripLeave(fade: MotionTokenId = 'menu.fade', speed: SpeedName = motionSpeed()) {
  const total = stripSeconds(speed), spec = springForFrequent(fade, speed);
  if (!total || !spec) return { opacity: 0, transition: { duration: 0 } };
  // The fade reaches zero at the spring's ~99% point (1.06 × its perceptual duration), never after 60% of the room's close.
  const share = Math.min(.6, spec.duration * 1.06 / total);
  return { opacity: [null, 0, 0] as (number | null)[], transition: { duration: total + .03, times: [0, share, 1], ease: 'easeOut' as const } };
}

// --- Glide: an element drawn away from its layout place that settles back on a spring, with its speed kept --------------
// A layout change moves an element at once; a glide hides that by drawing it where it was (the individual `translate`
// property, compositor-only, so it never collides with an element's own `transform`) and settling it to its new place.
// The state of every glide is known analytically (`glideAt`), so a second change while one is flying starts from where the
// element is drawn and how fast it is moving: nothing stops dead and nothing jumps (SwiftUI's retargeting).
const glides = new WeakMap<Element, Glide & { animation: Animation }>();
/** Where an element that glides is drawn from its layout place now, and how fast it moves (rest when it is not gliding). */
export const glideState = (el: Element, now = performance.now()): GlideState => { const glide = glides.get(el); return glide ? glideAt(glide, now) : atRest; };
/** Stop an element's glide so its layout place can be measured. Returns where it was drawn and how fast it moved, or null. */
export function pauseGlide(el: Element, now = performance.now()): GlideState | null {
  const glide = glides.get(el); if (!glide) return null;
  const state = glideAt(glide, now); glide.animation.cancel(); glides.delete(el); return state;
}
/** Glide an element whose layout place moved by `shift` (where it was − where it is, in px): it settles from its old place on
 * `spec`, carrying the state a running glide had (`carried`: what `pauseGlide` returned; omit it to pause here). With no
 * spring (motion off) or no distance left it does nothing. */
export function glideBy(el: HTMLElement, shift: { x: number; y: number }, spec: SpringSpec | null, carried: GlideState | null = pauseGlide(el)): Animation | null {
  if (!spec) return null;
  const start = glideStart(carried ?? atRest, shift), pv = Math.round(start.pv * 20) / 20;
  if (negligible(start)) return null;
  const { duration, easing } = springEasing(spec, 1, pv);
  const animation = el.animate({ translate: [`${start.fromX}px ${start.fromY}px`, '0px 0px'] }, { duration, easing, fill: 'none' });
  glides.set(el, { fromX: start.fromX, fromY: start.fromY, pv, startedAt: performance.now(), spec, animation });
  const forget = () => { if (glides.get(el)?.animation === animation) glides.delete(el); };
  animation.addEventListener('finish', forget); animation.addEventListener('cancel', () => { if (glides.get(el)?.animation === animation) glides.delete(el); });
  return animation;
}
/** The elements after a list or a block that move when it changes height (a section below it): its following siblings and
 * those of its first ancestors, up to the page's main area. Only elements in the flow. */
export function followersOf(host: HTMLElement, limit = 24): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let node: HTMLElement | null = host, depth = 0; node && depth < 3 && out.length < limit; node = node.parentElement, depth++) {
    for (let next = node.nextElementSibling; next && out.length < limit; next = next.nextElementSibling) {
      if (!(next instanceof HTMLElement) || next.hasAttribute('data-motion-skip') || next.hasAttribute('data-motion-ghost') || !next.getClientRects().length) continue;
      const position = getComputedStyle(next).position; if (position === 'absolute' || position === 'fixed') continue;
      out.push(next);
    }
    if (node.matches('main,[role=main],.bs-main,body')) break;
  }
  return out;
}

export interface ListMotionOptions {
  /** A custom glide spring (stretched by the speed setting). Default: the `reorder.move` token. */
  spring?: SpringSpec;
  token?: MotionTokenId;
  /** A surface used a hundred times a day (suggestions, the command bar, the tab viewer): takes only part of the Premium stretch. */
  frequent?: boolean;
  /** The elements after the list (a section below it) glide when the list changes height, so nothing below it jumps. */
  followers?: boolean;
  /** When this changes the layout was reorganised by something else (a layout switch, a view transition): the new places are
   * recorded without a glide. */
  rebase?: unknown;
}
/** A list that filters, reorders, grows or shrinks (History, Bookmarks, Downloads, Settings lists, the tab viewer, the command
 * bar, suggestions, Rewind, the bookmarks bar). Rows that stay glide to their new place on the `reorder.move` spring (R3-26,
 * R3-70), a row moved again mid-flight carries on from where it is drawn and how fast it moves, new rows fade in and settle 4px
 * on the effects spring, and rows that leave fade out where they were, all stretched by the animation-speed setting (Off: the
 * list changes at once). Pass the list element (its direct children are the rows; React keys keep a row's element, which is
 * how a row is recognised) and what the change depends on, such as the query. Positions are measured in the list's own scroll
 * space, so scrolling between changes is harmless. With `followers` the sections after the list glide too. */
export function useListMotion(list: RefObject<HTMLElement | null>, signature: unknown, options: ListMotionOptions = {}): void {
  const last = useRef(new Map<Element, Place>());
  const seen = useRef(false), base = useRef(options.rebase);
  useLayoutEffect(() => {
    const host = list.current; if (!host) return;
    const rebased = !Object.is(base.current, options.rebase); base.current = options.rebase;
    const rows = ([...host.children] as HTMLElement[]).filter(row => !row.hasAttribute('data-motion-ghost') && !row.hasAttribute('data-motion-skip'));
    const speed = motionSpeed(), measured = rows.length <= rowCap, frequent = !!options.frequent;
    const tracked = !measured ? [] : options.followers ? [...rows, ...followersOf(host)] : rows, isRow = new Set<Element>(rows);
    // Every glide in flight stops for a moment so layout places can be read; each one restarts from the state it was in.
    const now = performance.now(), carried = new Map<HTMLElement, GlideState>();
    for (const el of tracked) { const state = pauseGlide(el, now); if (state) carried.set(el, state); }
    const box = host.getBoundingClientRect(), places = new Map<Element, Place>();
    for (const el of tracked) places.set(el, { ...placeIn(host, box, el), row: isRow.has(el) });
    const before = last.current; last.current = places;
    if (!seen.current || rebased) { seen.current = true; return; }
    if (speed === 'off') return;
    if (!measured) { playSpring(host, [{ opacity: .4 }, { opacity: 1 }], springNow('materialize', frequent), { fill: 'none' }); return; }
    const glideSpring = options.spring ? { duration: options.spring.duration * motionScale(), bounce: options.spring.bounce } : springNow(options.token ?? 'reorder.move', frequent);
    const plan = planList(before, places), enter = springNow('menu.content', frequent), leave = springNow('menu.fade', frequent);
    for (const [el, shift] of plan.glide) glideBy(el as HTMLElement, { x: shift.dx, y: shift.dy }, glideSpring, carried.get(el as HTMLElement) ?? null);
    // A glide that was flying while the layout did not move this time carries on from the state it had.
    for (const [el, state] of carried) if (!plan.glide.has(el)) glideBy(el, { x: 0, y: 0 }, glideSpring, state);
    for (const key of plan.enter) if (isRow.has(key)) playSpring(key as HTMLElement, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], enter, { fill: 'backwards' });
    // Rows that left: a copy fades out where the row stood, while the list moves on underneath it.
    let positioned = false;
    for (const [row, box] of plan.leave) {
      const element = row as HTMLElement, was = box as Place;
      if (!was.row || element.isConnected) continue;
      if (!positioned) { positioned = true; if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; }
      const ghost = element.cloneNode(true) as HTMLElement;
      ghost.setAttribute('data-motion-ghost', ''); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      Object.assign(ghost.style, { position: 'absolute', left: `${was.x}px`, top: `${was.y}px`, width: `${was.w}px`, height: `${was.h}px`, margin: '0', pointerEvents: 'none', zIndex: '0' });
      host.appendChild(ghost);
      const fade = playSpring(ghost, [{ opacity: 1 }, { opacity: 0 }], leave, { fill: 'forwards' });
      if (fade) fade.finished.then(() => ghost.remove(), () => ghost.remove()); else ghost.remove();
    }
  }, [signature, options.rebase]);
}

/** True while something is shown and for a moment after it stops being (`ms`, scaled by the speed setting; none when motion
 * is off): a surface that unmounts the moment its flag turns off keeps its content on screen while its container fades or
 * moves away (the bookmarks bar). It never unmounts and remounts: the held render is the same render. */
export function useExitHold(visible: boolean, ms = 300): boolean {
  const [, bump] = useState(0), until = useRef(0), was = useRef(visible);
  if (was.current && !visible) until.current = performance.now() + ms * motionScale('S');
  was.current = visible;
  const held = !visible && performance.now() < until.current;
  useLayoutEffect(() => {
    if (!held) return;
    const timer = setTimeout(() => bump(n => n + 1), Math.max(0, until.current - performance.now()) + 16);
    return () => clearTimeout(timer);
  }, [held]);
  return held;
}

/** A list whose rows swap places (Settings › Sidebar sections ↑/↓, Customize toolbar, shortcut order): FLIP on the morph
 * spring (R3-55, R3-26). Rows move on the compositor and land softly; a row moved again mid-flight carries on from where
 * it is shown and how fast it moves; with animation off the rows swap at once. */
export const useFlip = (list: RefObject<HTMLElement | null>, signature: unknown): void => useListMotion(list, signature, { token: "reorder.move" });

/** An in-page section switch (Settings sections, Library tabs, Bookmarks folders, Rewind days): the new section fades
 * in and settles 6px, sideways from the side it comes from when `direction` says so (-1 back, 1 forward), on the
 * `panel.expand` spring (a frequent surface: 40% of the Premium stretch). The old section is gone at once, so nothing
 * waits on it. */
export function useSectionMotion(target: RefObject<HTMLElement | null>, key: unknown, direction: -1 | 0 | 1 = 0): void {
  const previous = useRef(key);
  useLayoutEffect(() => {
    if (Object.is(previous.current, key)) return;
    previous.current = key;
    const el = target.current; if (!el) return;
    const from = direction ? `translateX(${direction * 12}px)` : 'translateY(6px)';
    playSpring(el, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], springNow('panel.expand', true), { fill: 'backwards' });
  }, [key]);
}

/** The sidebar's spring (the same curve the sidebar's own slide, the page card and main's native page follow), 480 ms at Premium
 * and 240 in Fast (`--motion-pace`): never stretched by Premium, so the four stay in step at every speed. */
const PAGE_GLIDE_MS = 480;
const PAGE_SPRING = 'linear(0,.03361,.112,.21091,.31536,.41656,.50969,.59255,.66451,.72589,.77752,.82045,.85584,.88478,.9083,.9273,.94258,.95483,.9646,.97237,.97853,.9834,.98725,.99027,.99265,.99452,.99598,.99712,.99801,.99871,.99925,.99967,1)';
/** R6 (founder: "the way websites respond to dimension changes is too cutty and slow", "remove the blur"): while the sidebar or the
 * toolbar changes the page's size, the page's content is not frozen into a picture and frosted. It stands in its old box and
 * grows or shrinks to the new one on the sidebar's spring, so a page the interface draws (a new tab, Settings, a split's
 * panes and titles) lays out live, frame by frame, beside the sliding sidebar. The named page layer in the view transition follows
 * the live element (sidebar.css), so nothing shows around it. A website's own view is placed by main on the same curve. */
/** The size each website pane of a split ends at while the page follows (measured on the new layout, before the old box is applied): the layouts sent meanwhile carry it, and main
 * holds the pane's layout there while the interface moves the pane a frame at a time, so its site lays out once instead of on every frame (desktop/page-motion.cjs placeLive;
 * reported 10 Nov 2026: split view "really laggy", 13 to 20 layouts per pane per slide). */
let followSizes = new Map<string, { width: number; height: number }>();
export const pageFollowSize = (tabId: string): { width: number; height: number } | undefined => document.documentElement.dataset.pageLive !== undefined ? followSizes.get(tabId) : undefined;
/** Fired when a follow ends: the layout is sent once more, without the held size, so main lets the panes lay out at their final size at once. */
export const PAGE_FOLLOW_END = 'acira-page-follow-end';
function followPage(before: DOMRect | null | undefined): { start: () => void; stop: () => void } | null {
  const content = document.querySelector<HTMLElement>('.page-area > .page-content:not([data-native])');
  if (!content || !before) return null;
  const after = content.getBoundingClientRect(), root = document.documentElement, style = content.style;
  const px = (n: number) => `${n}px`, from = { marginLeft: px(before.left - after.left), marginTop: px(before.top - after.top), width: px(before.width), height: px(before.height) };
  if ([before.left - after.left, before.top - after.top, before.width - after.width, before.height - after.height].every(delta => Math.abs(delta) < 1)) return null;
  const to = { marginLeft: '0px', marginTop: '0px', width: px(after.width), height: px(after.height) };
  // Measured the way App's physicalLayout measures a pane (its title row is not the website's), on the layout it lands on.
  followSizes = new Map([...(content.querySelectorAll?.<HTMLElement>('.page-pane[data-pane][data-web]') ?? [])].flatMap(pane => { const r = pane.getBoundingClientRect(), label = pane.querySelector<HTMLElement>('.split-label')?.offsetHeight || 0, width = Math.round(r.right) - Math.round(r.left), height = Math.round(r.bottom) - Math.round(r.top + label); return pane.dataset.pane && width > 0 && height > 0 ? [[pane.dataset.pane, { width, height }] as const] : []; }));
  const sizes = followSizes;
  // Applied with the update itself, so the first frame of the transition already shows the old box.
  Object.assign(style, from); root.dataset.pageLive = '';
  let animation: Animation | null = null, stopped = false;
  const stop = () => { animation?.cancel(); animation = null; Object.assign(style, { marginLeft: '', marginTop: '', width: '', height: '' }); delete root.dataset.pageLive; if (followSizes === sizes) followSizes = new Map(); if (!stopped) { stopped = true; try { window.dispatchEvent(new Event(PAGE_FOLLOW_END)); } catch { /* no window (tests): nothing listens */ } } };
  const start = () => { animation = content.animate([from, to], { duration: PAGE_GLIDE_MS * motionPace(), easing: PAGE_SPRING, fill: 'both' }); animation.finished.then(stop, () => {}); };
  return { start, stop };
}

/** The frame's band above the page card, its strip below it and the docked sidebar's width, as the layout stands (the toolbar is 36 px in Full, 32 in Compact and Focus; the card
 * keeps a 6 px margin below). The layout switch's glass veil (view-morph.css) tints the band and the strip across the sidebar's column for the whole slide, which the sliding
 * sidebar leaves bare ahead of its edge (founder, 5 Nov, Windows), and keeps the frame's old or new picture off the column's middle, where the sidebar's own veil lies. Read
 * before the switch (the frame it leaves) and after its update (the frame it shows): a docked sidebar in either one sets them, the frame with none leaves them as they were. */
function measureFrameBands(before: boolean): void {
  const style = document.documentElement.style, rail = document.querySelector<HTMLElement>('.app > .ed-rail.is-expanded:not(.is-peek)')?.getBoundingClientRect?.();
  if (!rail || !rail.width) { if (before) style.setProperty('--frame-rail-width', '0px'); return; }
  const card = document.querySelector<HTMLElement>('.browser-body > .page-area')?.getBoundingClientRect?.(), height = typeof window === 'undefined' ? 0 : window.innerHeight;
  if (!card || !card.width || !height) return;
  style.setProperty('--frame-rail-width', `${rail.width}px`);
  style.setProperty('--frame-band-top', `${Math.max(0, card.top)}px`);
  style.setProperty('--frame-band-bottom', `${Math.max(0, height - card.bottom)}px`);
}

/** The spring the native page's top edge follows when a layout switch raises it (entering Seamless: the toolbar's hide spring, chromeEdge.ts), or null for the sidebar's curve. */
let pageRiseSpring: (() => { duration: number; bounce: number } | null) | null = null;
export const registerPageRiseSpring = (source: () => { duration: number; bounce: number } | null): void => { pageRiseSpring = source; };
/** The page's top edge rising over the toolbar's row (entering Seamless): the controls that leave ride up with it on its spring, instead of standing there while the page covers them
 * from below (founder, 6 Nov). `--page-rise` is the distance, `--page-rise-ms` and `--page-rise-ease` the spring; view-morph.css reads them. */
function measurePageRise(before: DOMRect | null | undefined): void {
  const root = document.documentElement, after = document.querySelector('.page-content')?.getBoundingClientRect?.();
  if (!before || !after) return;
  const rise = Math.round(before.top - after.top); if (rise < 8) return;
  const spec = pageRiseSpring?.(), fallback = { duration: PAGE_GLIDE_MS * motionPace(), easing: PAGE_SPRING }, spring = spec ? springEasing(spec, 1) : fallback;
  root.style.setProperty('--page-rise', `${rise}px`); root.style.setProperty('--page-rise-ms', `${Math.round(spring.duration)}ms`); root.style.setProperty('--page-rise-ease', spring.easing);
  root.dataset.pageRise = '';
}
const clearPageRise = (): void => { const root = document.documentElement; if (!('pageRise' in root.dataset)) return; delete root.dataset.pageRise; for (const name of ['--page-rise', '--page-rise-ms', '--page-rise-ease']) root.style.removeProperty(name); };
type ModeTransition = { ready: Promise<void>; finished: Promise<void> };
/** The transition that is playing now, as a promise that settles once its layers are gone and `data-mode-switch` has been cleared. A layout switch asked for while one is playing
 * cannot start its own (a view transition replaces the running one, and without one the new layout would show at once under the old one's layers, the page jumping to its end state
 * while main glides it from where it stands): it waits for this, then plays as a morph of its own. Capped, so a window that never finishes a transition cannot hold a switch back. */
let playing: Promise<void> | null = null;
const SETTLE_MAX_MS = 700;
export const modeSwitchPlaying = (): boolean => playing !== null;
export function whenModeSwitchSettled(): Promise<void> {
  const wait = playing; if (!wait) return Promise.resolve();
  return Promise.race([wait.then(whenModeSwitchSettled), new Promise<void>(resolve => setTimeout(resolve, SETTLE_MAX_MS))]);
}
/** A layout switch (the sidebar docking or leaving, the compact chrome) in the interface is a view transition: its new frame is rendered and
 * snapshotted before its layers start to move. The native page's own glide used to start the moment the new layout reached the main process,
 * which is before that, so the page ran ahead of the card it sits in by however long the snapshot took (5 to 16 pt, and different on every
 * run): a doubled layer. The layout is now sent at the transition's ready boundary, the latest one only. Only the page's slide on the
 * sidebar's own curve waits (`gated`): a toolbar or Seamless glide runs on its own spring against its own boundary (chromeEdge.ts). */
let layoutSwitchReady: Promise<void> | null = null, pendingLayoutSend: (() => void) | null = null;
export function sendWhenLayoutSwitchReady(send: () => void, gated = true): void {
  // data-qa-no-layout-gate: a rig measures the page without the wait, for its before.
  const gate = gated && !document.documentElement.hasAttribute('data-qa-no-layout-gate') ? layoutSwitchReady : null;
  if (!gate) { pendingLayoutSend = null; send(); return; }
  pendingLayoutSend = send;
  void gate.then(() => { if (pendingLayoutSend === send) { pendingLayoutSend = null; send(); } });
}
type ViewTransitionStart = (update: () => void) => ModeTransition;
/** A mode or appearance switch (theme, finish, tint, glass, density, compact/comfortable, strip/sidebar, bookmarks bar):
 * one crossfade of the whole frame plus a glide of every element that carries a `view-transition-name`, as K's setup
 * tone switch does. It is a view transition: the compositor fades the old frame's snapshot over the new one, so the
 * switch can't stop halfway while the page is busy. `update` must apply the change synchronously (flushSync). Its
 * duration is `240ms × --motion-scale` (transient.css). `edge` is Seamless's reveal and hide (ui/chromeEdge.ts): the spring comes from
 * `--edge-ms` and `--edge-ease`, set just before (seamless.css). */
export function startModeTransition(update: () => void, kind: 'appearance' | 'layout' | 'edge' = 'appearance', slideHint?: BlockSlide): ModeTransition | null {
  const start = (document as Document & { startViewTransition?: ViewTransitionStart }).startViewTransition;
  const root = document.documentElement;
  if (!start || reducedMotion() || document.visibilityState !== 'visible' || root.hasAttribute('data-fr-switch') || root.hasAttribute('data-mode-switch')) { update(); return null; }
  root.dataset.modeSwitch = kind;
  // An appearance switch under the crossfade starts no color transitions (transient.css): the attribute and the new
  // tokens land in one commit, so nothing has to be found and finished afterwards (F04).
  const before = kind === 'layout' ? document.querySelector('.page-content')?.getBoundingClientRect() : null;
  const blockBefore = kind === 'layout' ? document.querySelector<HTMLElement>('.browser-shell[data-sbmode]')?.dataset.sbmode : undefined;
  // The picture of the old state is taken when the switch starts, so a block that is about to leave with the sidebar must already be one layer (its controls un-named) then.
  if (slideHint === 'out' && blockBefore === 'block') root.dataset.blockSlide = 'out';
  if (kind === 'layout') measureFrameBands(true);
  let follow: ReturnType<typeof followPage> = null;
  const run = () => {
    if(kind === 'appearance') root.dataset.themeSettle = '';
    update();
    if(kind === 'layout') { const slide = blockSlideOf(blockBefore, document.querySelector<HTMLElement>('.browser-shell[data-sbmode]')?.dataset.sbmode); if (slide) root.dataset.blockSlide = slide; else delete root.dataset.blockSlide; measureFrameBands(false); measurePageRise(before); follow = followPage(before); if (follow) root.dataset.pageFollow = ''; }
  };
  const transition = start.call(document, run);
  if (kind === 'layout' && transition.ready) {
    const mine: Promise<void> = Promise.race([transition.ready.then(() => {}, () => {}), new Promise<void>(resolve => window.setTimeout(resolve, 120))]);
    layoutSwitchReady = mine;
    void mine.then(() => { if (layoutSwitchReady === mine) layoutSwitchReady = null; });
  }
  // A newer reveal or workspace selection can skip this snapshot. Its update still
  // completes; consuming ready's rejection avoids an uncaught animation-only error.
  void transition.ready?.then(() => follow?.start(), () => {});
  transition.finished.finally(() => { follow?.stop(); if (kind === 'layout') clearPageRise(); if (root.dataset.modeSwitch === kind) delete root.dataset.modeSwitch; delete root.dataset.pageFollow; delete root.dataset.blockSlide; delete root.dataset.themeSettle; if(kind==='edge')delete root.dataset.edgeSnapshot; });
  const mine: Promise<void> = transition.finished.then(() => {}, () => {}).then(() => { if (playing === mine) playing = null; });
  playing = mine;
  return transition;
}

/** The settings whose change repaints the whole frame: a new snapshot that changes one of them crossfades in. */
const appearanceKeys = ['appearance', 'colorPreset', 'browserTint', 'accentColor', 'windowFinish', 'glassOpacity', 'surfaceColor', 'sidebarColor', 'tabColor', 'toolbarColor', 'highContrast', 'reducedTransparency'] as const;
export function appearanceChanged(previous: { settings?: object } | null | undefined, next: { settings?: object } | null | undefined): boolean {
  const a = previous?.settings as Record<string, unknown> | undefined, b = next?.settings as Record<string, unknown> | undefined;
  if (!a || !b) return false;
  return appearanceKeys.some(key => a[key] !== b[key]);
}
