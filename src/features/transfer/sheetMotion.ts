// The motion of the sending side (spec 5.1 moments 1-3, 5-9, 12-14; the pictures' stepped strips 30-33 are the drawings of it).
//
// Only the app's own springs (src/ui/springs.ts: morph, settle, snappy, quick) played through `animateSpring`, so the Animation speed setting stretches them and
// Off returns null; only transform, opacity and blur filter are animated. Every function returns the animations it started and starts none at Animation speed
// Off or when the sheet was told `reduced`: the screen is then simply its end state (an instant cut). Nothing here invents a curve.
//
// Moments, and which function plays them:
//   3  Create code becomes the code: the button's surface morphs into the card (`morphIntoCard`), the five chips arrive on the 40 ms stagger (`enterStagger`)
//   6  the pairing moment: the code card collapses toward the centre (`collapseCard`), the glyphs slide in on `snappy` (`slideDevices`), the scan fades in
//   7  the number (A): the digit cells drop in from the top on `morph`, each typed digit settles into its cell on `quick` (`dropIn`, `settleDigit`)
//   8  the right number: the digit field becomes the progress grid (`flyDigitsToGrid`); a wrong number dims the cells, no shake (the EndState fades in)
//   9  transfer: the grid glides to the verified bytes (`useGlide`)
//  12  done: the check mark and the follow-up buttons rise in (`enterStagger`)
//  13  cancel, expiry, mismatch: the chips dim to .4 and blur out, the message fades in (CSS transition in transfer.css, `fadeIn`)
// The handoff below carries a measured box (the button, the card, the digit field) from the screen that is leaving to the one that arrives.
import { useEffect, useRef, useState } from 'react';
import { animateSpring, motionScale, motionSpeed, springFlight, springs, type SpringFlight } from '../../ui/sharedMotion';

/** Spec 5.1: the chips (and the follow-ups) arrive 40 ms apart (`--motion-stagger`). */
export const STAGGER_MS = 40;

const off = (reduced?: boolean) => Boolean(reduced) || motionSpeed() === 'off';

// ------------------------------------------------------------------------------------------------ keyframes (pure, so they can be checked)

/** A chip arriving (moment 3): opacity 0 to 1, up from 6 px below, out of a 4 px blur. */
export const chipFrames = (): Keyframe[] => [{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' }];
/** A row or button arriving (moment 12): the same rise without the blur. */
export const riseFrames = (): Keyframe[] => [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }];
export const fadeFrames = (): Keyframe[] => [{ opacity: 0 }, { opacity: 1 }];
/** The delay of the n-th item of a stagger. */
export const staggerDelay = (index: number, base = 0) => base + index * STAGGER_MS;

// ------------------------------------------------------------------------------------------------ the handoff between screens

type Kind = 'button' | 'card' | 'digits';
interface Held { kind: Kind; rect: DOMRect; clone?: HTMLElement; at: number }
let held: Held | null = null;
const FRESH_MS = 1500;
/** The leaving screen leaves its measured box (and, for the card and the digits, a copy of itself) for the screen that arrives next. */
export function stash(kind: Kind, node: HTMLElement | null | undefined, { clone = false }: { clone?: boolean } = {}): void {
  if (!node || typeof node.getBoundingClientRect !== 'function') return;
  held = { kind, rect: node.getBoundingClientRect(), clone: clone ? (node.cloneNode(true) as HTMLElement) : undefined, at: Date.now() };
}
/**
 * What the leaving screen left, if it is fresh and of that kind. Reading it does not clear it (a render may run twice); the screen that played it calls
 * `dropHandoff` from its layout effect.
 */
export function take(kind: Kind): { rect: DOMRect; clone?: HTMLElement } | null {
  const mine = held;
  return mine && mine.kind === kind && Date.now() - mine.at < FRESH_MS ? { rect: mine.rect, clone: mine.clone } : null;
}
export const dropHandoff = () => { held = null; };

// ------------------------------------------------------------------------------------------------ the moments

/** Opacity, rise (and optionally blur) for a list of elements, each 40 ms after the one before, on `settle`. Moments 3 and 12. */
export function enterStagger(items: ArrayLike<Element>, { base = 0, blur = false, reduced }: { base?: number; blur?: boolean; reduced?: boolean } = {}): Animation[] {
  if (off(reduced)) return [];
  const done: Animation[] = [];
  Array.from(items).forEach((item, index) => {
    const animation = animateSpring(item, blur ? chipFrames() : riseFrames(), springs.settle, { delay: staggerDelay(index, base) });
    if (animation) done.push(animation);
  });
  return done;
}

/** Opacity only, on `settle` (counts on S1 arrive already final, the message of an end state arrives calm). */
export function fadeIn(item: Element | null | undefined, { base = 0, reduced }: { base?: number; reduced?: boolean } = {}): Animation | null {
  if (!item || off(reduced)) return null;
  return animateSpring(item, fadeFrames(), springs.settle, { delay: base });
}

/**
 * Moment 3. The code card's plate grows from the box the Create code button had (`morph`, translate and scale from the top-left); the button's own colors
 * and label ride on it as a ghost that fades out, so the surface reads as the button turning into the card. The text of the card never scales: the chips,
 * the title and the status line fade in on their own stagger.
 */
export function morphIntoCard(parts: { plate: HTMLElement | null; ghost: HTMLElement | null; chips: ArrayLike<Element>; title?: Element | null; status?: Element | null; timer?: Element | null }, from: DOMRect | null, reduced?: boolean): Animation[] {
  const out: Animation[] = [];
  if (off(reduced)) { parts.ghost?.remove(); return out; }
  if (from && parts.plate) {
    const moved = morphFromPlate(parts.plate, from);
    if (moved) out.push(moved);
  }
  if (parts.ghost) {
    const gone = animateSpring(parts.ghost, [{ opacity: 1 }, { opacity: 0 }], springs.quick);
    if (gone) { out.push(gone); gone.finished.then(() => parts.ghost?.remove(), () => parts.ghost?.remove()); } else parts.ghost.remove();
  }
  out.push(...enterStagger(parts.chips, { base: 150, blur: true }));
  for (const [node, base] of [[parts.title, 200], [parts.status, 340], [parts.timer, 400]] as const) { const faded = fadeIn(node, { base }); if (faded) out.push(faded); }
  return out;
}
function morphFromPlate(plate: HTMLElement, from: DOMRect): Animation | null {
  const to = plate.getBoundingClientRect();
  if (!to.width || !to.height) return null;
  plate.style.transformOrigin = '0 0';
  const animation = animateSpring(plate, [{ translate: `${from.left - to.left}px ${from.top - to.top}px`, scale: `${from.width / to.width} ${from.height / to.height}` }, { translate: '0 0', scale: '1 1' }], springs.morph, { fill: 'backwards' }, true);
  animation?.finished.then(() => { plate.style.transformOrigin = ''; }, () => { plate.style.transformOrigin = ''; });
  return animation;
}

/** A copy of the leaving screen's box, drawn where it was inside `host` (a positioned ancestor), for the arriving screen to animate away. */
function ghostIn(host: HTMLElement, copy: HTMLElement, rect: DOMRect): HTMLElement {
  const hostBox = host.getBoundingClientRect();
  copy.setAttribute('aria-hidden', 'true');
  copy.removeAttribute('id');
  Object.assign(copy.style, { position: 'absolute', left: `${rect.left - hostBox.left}px`, top: `${rect.top - hostBox.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', pointerEvents: 'none', transformOrigin: '50% 50%', zIndex: '2' });
  host.append(copy);
  return copy;
}

/** Moment 6, first part. The code card (a copy of it) collapses toward the centre of the strip and is gone; the strip's glyphs and grid arrive around it. */
export function collapseCard(host: HTMLElement | null, held: { rect: DOMRect; clone?: HTMLElement } | null, toward: DOMRect | null, reduced?: boolean): Animation | null {
  if (!host || !held?.clone || off(reduced)) return null;
  const ghost = ghostIn(host, held.clone, held.rect);
  const dx = toward ? toward.left + toward.width / 2 - (held.rect.left + held.rect.width / 2) : 0, dy = toward ? toward.top + toward.height / 2 - (held.rect.top + held.rect.height / 2) : 0;
  const animation = animateSpring(ghost, [{ transform: 'translate(0px, 0px) scale(1)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.14)`, opacity: 0 }], springs.settle);
  if (!animation) { ghost.remove(); return null; }
  animation.finished.then(() => ghost.remove(), () => ghost.remove());
  return animation;
}

/** Moment 6, second part. The two device glyphs slide in from the left and the right on `snappy`; their names and the grid follow. */
export function slideDevices(parts: { left: Element | null; right: Element | null; wire: Element | null; labels?: ArrayLike<Element> }, reduced?: boolean): Animation[] {
  if (off(reduced)) return [];
  const out: Animation[] = [];
  const slide = (item: Element | null, from: number, delay: number) => {
    if (!item) return;
    const animation = animateSpring(item, [{ transform: `translateX(${from}px)`, opacity: 0 }, { transform: 'translateX(0px)', opacity: 1 }], springs.snappy, { delay }, true);
    if (animation) out.push(animation);
  };
  slide(parts.left, -64, 50); slide(parts.right, 64, 80);
  const grid = fadeIn(parts.wire, { base: 140 }); if (grid) out.push(grid);
  return out;
}

/** Moment 7 (A). The request's digit field drops in from the top of the sheet on `morph`; its two cells follow on the stagger. */
export function dropIn(field: Element | null, cells: ArrayLike<Element>, reduced?: boolean): Animation[] {
  if (!field || off(reduced)) return [];
  const out: Animation[] = [];
  const dropped = animateSpring(field, [{ transform: 'translateY(-24px)', opacity: 0 }, { transform: 'translateY(0px)', opacity: 1 }], springs.morph, {}, true);
  if (dropped) out.push(dropped);
  out.push(...enterStagger(cells, { base: STAGGER_MS, reduced }));
  return out;
}

/** Moment 7 (A). A typed digit settles into its cell on `quick`. */
export function settleDigit(cell: Element | null | undefined, reduced?: boolean): Animation | null {
  if (!cell || off(reduced)) return null;
  return animateSpring(cell, [{ transform: 'scale(.82)', opacity: .4 }, { transform: 'scale(1)', opacity: 1 }], springs.quick);
}

/**
 * Moment 8. The digit field (a copy of it) becomes the progress grid: it travels to the grid's box and fades as the grid beneath fades in. The text around
 * them changes on its own fade. A wrong number never comes here: its cells dim and the card resolves into the message.
 */
export function flyDigitsToGrid(host: HTMLElement | null, held: { rect: DOMRect; clone?: HTMLElement } | null, wire: HTMLElement | null, reduced?: boolean): Animation[] {
  if (!host || !wire || off(reduced)) return [];
  const out: Animation[] = [];
  const to = wire.getBoundingClientRect();
  const faded = fadeIn(wire, { base: 120 }); if (faded) out.push(faded);
  if (held?.clone) {
    const ghost = ghostIn(host, held.clone, held.rect);
    const dx = to.left + to.width / 2 - (held.rect.left + held.rect.width / 2), dy = to.top + to.height / 2 - (held.rect.top + held.rect.height / 2);
    const sx = to.width / Math.max(1, held.rect.width), sy = to.height / Math.max(1, held.rect.height);
    const animation = animateSpring(ghost, [{ transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0 }], springs.morph, {}, true);
    if (animation) { out.push(animation); animation.finished.then(() => ghost.remove(), () => ghost.remove()); } else ghost.remove();
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the progress glide (moment 9)

/**
 * A fraction that glides to its target on `settle` instead of jumping (and never goes back down). It re-renders only when the visible step (1 / 100)
 * changes. At Animation speed Off, or when `reduced`, it is the target itself.
 */
export function useGlide(target: number, reduced?: boolean): number {
  const clean = Math.min(1, Math.max(0, Number.isFinite(target) ? target : 0));
  const [value, setValue] = useState(clean), best = useRef(clean), flight = useRef<SpringFlight | null>(null), frame = useRef(0), shown = useRef(clean);
  useEffect(() => {
    const goal = Math.max(best.current, clean);
    best.current = goal;
    if (off(reduced) || !motionScale()) { shown.current = goal; setValue(goal); return; }
    const now = performance.now(), from = flight.current ? flight.current.at(now).value : shown.current;
    flight.current = springFlight(springs.settle, from, goal, now, motionScale(), flight.current ? flight.current.at(now).velocity : 0);
    cancelAnimationFrame(frame.current);
    const tick = () => {
      const f = flight.current!, at = performance.now(), next = Math.min(goal, Math.max(shown.current, f.at(at).value));
      if (Math.round(next * 100) !== Math.round(shown.current * 100)) setValue(next);
      shown.current = next;
      if (!f.done(at)) frame.current = requestAnimationFrame(tick); else { shown.current = goal; setValue(goal); }
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [clean, reduced]);
  return value;
}

/** True while a value that should be moving has not changed for `ms` (a stalled transfer: the grid shows `progressHeld`). */
export function useStalled(value: number, active: boolean, ms = 4000): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (!active) return;
    const timer = setTimeout(() => setStalled(true), ms);
    return () => clearTimeout(timer);
  }, [value, active, ms]);
  return stalled;
}
