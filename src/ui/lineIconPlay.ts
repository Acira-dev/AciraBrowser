/** Beta 14 section G: plays the icon line-draw (Web Animations on the icon's own SVG, nothing else).
 *
 * The rules (the brief's):
 *  - The command never waits. Every behaviour starts on `pointerdown` (or a keyboard click) and plays alongside; no listener
 *    stops, delays or replaces the press. Morphs start in the same commit as the state change they show.
 *  - Premium plays the approved lengths, Fast plays half (`fastPace`), Off and reduced motion play nothing (the state just swaps).
 *  - It never loops, never runs while idle, and a new behaviour first cancels the icon's running one, so repeated presses never stack.
 *  - Morphs retarget: a Reload that is stopped halfway morphs on from the shape it has reached, never from a snapped one.
 *  - Hover redraws wait for the pointer to rest (ui/lineMotion.ts `HoverRest`), play once per hover, and a press wins.
 *  - It costs the page nothing while no icon moves: an icon rests as its own few paths (components/LineIcon.tsx; lineIconSet.ts REST_AS_ONE_PATH). The parts it is drawn from (the live drawing, `goLive` below) are
 *    built when a motion starts and taken away when the last animation of the icon ends. The player keeps its own list of an icon's running animations
 *    (asking the document, `getAnimations()`, flushes style, which in the middle of a commit is a whole extra style recalc). */
import { motionSpeed } from './sharedMotion';
import { HOVER_ICONS, HoverRest, LINE_EASE as EASE, LINE_MOVE, LINE_MS as MS, isAppearing, lineMs, linePace } from './lineMotion';
import { LINE_ICONS, canMorph, lineIconDef, slotOf, type LineIconName, type LinePath } from './lineIconSet';

const speedNow = () => motionSpeed();
/** The pace in force right now: 1 Premium, .5 Fast, 0 when motion is off. */
export const paceNow = (): number => linePace(speedNow());
const ms = (key: keyof typeof MS): number => lineMs(key, speedNow());

const SVG_NS = 'http://www.w3.org/2000/svg';
const pathsOf = (svg: Element): SVGPathElement[] => [...svg.querySelectorAll<SVGPathElement>(':scope > .li-g > path')];
const groupOf = (svg: Element): SVGGElement | null => svg.querySelector<SVGGElement>(':scope > .li-g');
const nameOf = (svg: Element): LineIconName | null => { const n = svg.getAttribute('data-li') as LineIconName | null; return n && n in LINE_ICONS ? n : null; };

// ---- the live drawing: the parts of an icon, there for the length of a motion ----

/** The animations the player has running on an icon. */
const running = new WeakMap<Element, Set<Animation>>();
const isBusy = (svg: Element): boolean => !!running.get(svg)?.size;

/** Take the live drawing away: the icon is its resting paths again (which already show the same drawing). */
function retire(svg: Element): void {
  svg.querySelectorAll(':scope > .li-ghost, :scope > .li-g').forEach(el => el.remove());
  svg.querySelectorAll(':scope > .li-hide').forEach(el => el.classList.remove('li-hide'));
}
/** Remember an animation of an icon; when the last one ends or is cancelled the live drawing goes. */
function track<T extends Animation>(svg: Element, animation: T): T {
  let set = running.get(svg); if (!set) running.set(svg, set = new Set());
  set.add(animation);
  const done = () => { const left = running.get(svg); if (left && left.delete(animation) && !left.size) retire(svg); };
  animation.finished.then(done, done);
  return animation;
}
function partOf(part: LinePath, filled: boolean): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', part.cls ? 'li-p ' + part.cls : 'li-p');
  path.setAttribute('d', part.d); path.setAttribute('pathLength', '1'); if (part.role) path.setAttribute('data-role', part.role);
  if (part.fill) { path.setAttribute('fill', 'currentColor'); path.setAttribute('fill-opacity', filled ? '1' : '0'); }
  return path;
}
/** Build the live drawing of `name` over the resting path (which is hidden while it is there). */
function goLive(svg: Element, name: LineIconName): SVGGElement {
  const def = lineIconDef(name), group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'li-g');
  for (const part of def.paths) group.appendChild(partOf(part, !!def.filled));
  svg.appendChild(group);
  for (const el of svg.children) if (el.classList.contains('li-rest')) el.classList.add('li-hide');
  return group;
}

/** Cancel every animation on an icon and remove its ghost, so a new behaviour starts from the resting drawing. */
function settle(svg: Element): void {
  svg.querySelectorAll(':scope > .li-ghost').forEach(el => el.remove());
  const set = running.get(svg); if (!set) return;
  const all = [...set]; set.clear(); all.forEach(animation => animation.cancel());
}

/** Draw a path along its length: dash `1 2` on a `pathLength=1` path, offset 1.01 to 0. The 2 (not 1) and the 1.01 keep the round cap
 * of a zero-length dash from showing as a dot at frame 0 (the website's own recipe shows it). */
function draw(svg: Element, path: SVGPathElement, duration: number, delay = 0, reverse = false): Animation {
  return track(svg, path.animate([{ strokeDasharray: '1 2', strokeDashoffset: reverse ? -1.01 : 1.01 }, { strokeDasharray: '1 2', strokeDashoffset: 0 }], { duration, delay, easing: EASE.draw, fill: 'backwards' }));
}
/** A faint copy of the icon under the line while it re-traces, so the button never looks empty. */
function ghost(svg: Element, duration: number): void {
  const group = groupOf(svg); if (!group) return;
  const copy = group.cloneNode(true) as SVGGElement; copy.setAttribute('class', 'li-ghost'); copy.setAttribute('aria-hidden', 'true');
  copy.querySelectorAll('path').forEach(path => path.removeAttribute('data-role'));
  svg.insertBefore(copy, group);
  const gone = () => copy.remove();
  track(svg, copy.animate([{ opacity: .3 }, { opacity: .3, offset: .55 }, { opacity: 0 }], { duration, easing: 'linear', fill: 'forwards' })).finished.then(gone, gone);
}
/** The drawing that is leaving, kept for a moment and faded out, so a stroke that is not in the new drawing never just vanishes. */
function outgoing(svg: Element, group: SVGGElement, leaving: ReadonlyArray<{ d: string }>, duration: number): void {
  if (!leaving.length) return;
  const gone = document.createElementNS(SVG_NS, 'g'); gone.setAttribute('class', 'li-ghost'); gone.setAttribute('aria-hidden', 'true');
  for (const part of leaving) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('class', 'li-p'); p.setAttribute('d', part.d); gone.appendChild(p); }
  svg.insertBefore(gone, group);
  const remove = () => gone.remove();
  track(svg, gone.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'forwards' })).finished.then(remove, remove);
}
const settleScale = (svg: Element, group: Element, duration: number, from = .86, peak = 1.04): Animation =>
  track(svg, group.animate([{ transform: `scale(${from})` }, { transform: `scale(${peak})`, offset: .6 }, { transform: 'scale(1)' }], { duration, easing: EASE.settle }));
const slide = (svg: Element, group: Element, dx: number, duration: number): Animation =>
  track(svg, group.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)`, offset: .32 }, { transform: 'translateX(0)' }], { duration, easing: EASE.glide }));

type Behaviour = (svg: Element, group: SVGGElement, paths: SVGPathElement[]) => void;
/** What each icon does when pressed (Premium lengths; `ms()` already applies the pace). */
const PRESS: Partial<Record<LineIconName, Behaviour>> = {
  // A small nudge the way the arrow points: it steps and comes back.
  back: (svg, group) => { slide(svg, group, -LINE_MOVE.nudge, ms('nudge')); },
  forward: (svg, group) => { slide(svg, group, LINE_MOVE.nudge, ms('nudge')); },
  prev: (svg, group) => { slide(svg, group, -LINE_MOVE.nudge, ms('nudge')); },
  next: (svg, group) => { slide(svg, group, LINE_MOVE.nudge, ms('nudge')); },
  // Roof, walls, door, in the hero's order, over a faint copy of the icon.
  home: (svg, group, paths) => { ghost(svg, ms('homeGhost')); paths.forEach((path, n) => draw(svg, path, ms('homeDraw'), n * ms('homeStagger'))); settleScale(svg, group, ms('homePop')); },
  // The ribbon redraws over a faint copy and settles, like Home: the same family in the sidebar footer, next to History and Settings.
  bookmark: (svg, group, paths) => { ghost(svg, ms('homeGhost')); draw(svg, paths[0], ms('homeDraw')); settleScale(svg, group, ms('homePop')); },
  // Rewind: the ring redraws round the clock, the hands sweep back, the arrowhead lands last.
  history: (svg, _, paths) => {
    const [ring, head, hands] = paths; ghost(svg, ms('historyGhost'));
    draw(svg, ring, ms('historyRing')); draw(svg, head, ms('historyHead'), ms('historyHeadDelay'));
    track(svg, hands.animate([{ transform: 'rotate(120deg)' }, { transform: 'rotate(0)' }], { duration: ms('historyHands'), easing: EASE.glide }));
  },
  // The arrow drops into the tray, drawing as it falls; the tray stays.
  downloads: (svg, _, paths) => {
    const [shaft, head] = paths; ghost(svg, ms('downloadGhost'));
    draw(svg, shaft, ms('downloadShaft')); draw(svg, head, ms('downloadHead'), ms('downloadHeadDelay'));
    for (const arrow of [shaft, head]) track(svg, arrow.animate([{ transform: 'translateY(-2.5px)' }, { transform: 'translateY(0)' }], { duration: ms('downloadDrop'), easing: EASE.glide }));
  },
  // The four arms grow out of the centre with a turn from -45 degrees, as in the sample (the brief says the turn may be dropped if it feels too lively: it is kept, as approved).
  new: (svg, group, paths) => { ghost(svg, ms('newGhost')); paths.forEach(path => draw(svg, path, ms('newDraw'))); track(svg, group.animate([{ transform: `rotate(-${LINE_MOVE.newTurn}deg) scale(${LINE_MOVE.newScale})` }, { transform: 'rotate(0) scale(1)' }], { duration: ms('newTurn'), easing: EASE.glide })); },
  // The gear turns two teeth (90 degrees) and settles, while the hub redraws: a visible turn, not the sample's barely seen one.
  settings: (svg, group, paths) => {
    ghost(svg, ms('settingsGhost'));
    track(svg, group.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(90deg)' }], { duration: ms('gearTurn'), easing: EASE.glide }));
    draw(svg, paths[1], ms('gearHub'), 60 * linePace(speedNow()));
  },
};

/** What each icon does when the pointer rests on it: a quick calm redraw, the strokes one after another. */
const HOVER: Partial<Record<LineIconName, Behaviour>> = {
  new: PRESS.new,
  x: (svg, _, paths) => { paths.forEach((path, n) => draw(svg, path, ms('xDraw'), n * ms('xStagger'))); },   // the sample's calm redraw: two strokes, no faint copy under them
  pin: (svg, _, paths) => { ghost(svg, ms('pinDraw') + ms('pinStagger')); paths.forEach((path, n) => draw(svg, path, ms('pinDraw'), n * ms('pinStagger'))); },
  // Beta 14: the optional screenshot button: the body, then the lens, over a faint copy, at the pin's calm pace.
  camera: (svg, _, paths) => { ghost(svg, ms('pinDraw') + ms('pinStagger')); paths.forEach((path, n) => draw(svg, path, ms('pinDraw'), n * ms('pinStagger'))); },
  // The puzzle piece is one stroke: it draws round once, the pin's length.
  puzzle: (svg, _, paths) => { ghost(svg, ms('pinDraw')); paths.forEach(path => draw(svg, path, ms('pinDraw'))); },
};

function play(svg: Element, table: Partial<Record<LineIconName, Behaviour>>): boolean {
  const name = nameOf(svg), behaviour = name && table[name];
  if (!behaviour || !name || !paceNow()) return false;
  settle(svg); retire(svg);
  const group = goLive(svg, name);
  behaviour(svg, group, pathsOf(svg));
  if (!isBusy(svg)) retire(svg);
  return true;
}
/** Play an icon's press behaviour (false when it has none, or motion is off). */
export const playPress = (svg: Element): boolean => play(svg, PRESS);
/** Play an icon's hover behaviour. */
export const playHover = (svg: Element): boolean => play(svg, HOVER);

// ---- state morphs: Reload <> Stop, the sidebar toggle open <> closed, the star empty <> saved, Play <> Pause ----

/** The value a property has right now, animation included (so a morph interrupted halfway goes on from where it is). */
const current = (el: Element, property: string): string => getComputedStyle(el).getPropertyValue(property);

/** Morph one icon drawing into another of the same slot. Called in the commit that changed the name, before paint, so it asks the style engine nothing unless the
 * icon is already moving (only then does it have to read the shape it has reached). */
/** TRUE: a morph interrupted halfway (Reload turned into Stop, and the page finishes loading 130 ms later) goes on from the shape it has reached. FALSE: it does what the approved sample does,
 * which is to jump to the start of the new morph (Stop's full X, in that case). The brief says nothing of snapping for state morphs, and asks hover never to snap, so the smooth way is kept; report 9d. */
const MORPH_FROM_SHAPE_REACHED = true;
export function playMorph(svg: Element, from: LineIconName, to: LineIconName): boolean {
  const pace = paceNow(); if (!pace) return false;
  const source = LINE_ICONS[from].paths, target = LINE_ICONS[to].paths, slot = slotOf(to);
  // Read where everything is now, before cancelling what is running. An icon that is not moving is where its drawing says.
  const moving = MORPH_FROM_SHAPE_REACHED && isBusy(svg), before = moving ? pathsOf(svg) : [], beforeGroup = moving ? groupOf(svg) : null;
  const was = target.map((part, i) => before[i] ? current(before[i], 'd') : `path("${source[i]?.d ?? part.d}")`);
  const turn = beforeGroup ? current(beforeGroup, 'transform') : 'none';
  const fillWas = target.map((_, i) => before[i] ? current(before[i], 'fill-opacity') : String(lineIconDef(from).filled ? 1 : 0));
  settle(svg); retire(svg);
  const group = goLive(svg, to), paths = pathsOf(svg);

  if (slot === 'star') {
    // Save: the fill floods in with a small press. Remove: the fill drains and the star settles back. (The outline never changes.)
    const saving = !!lineIconDef(to).filled, path = paths[0];
    track(svg, path.animate([{ fillOpacity: fillWas[0] }, { fillOpacity: saving ? 1 : 0 }], { duration: (saving ? MS.starFill : MS.starDrain) * pace, easing: saving ? EASE.fill : 'ease-out' }));
    track(svg, group.animate(saving
      ? [{ transform: 'scale(1)' }, { transform: 'scale(.84)', offset: .22 }, { transform: 'scale(1.08)', offset: .62 }, { transform: 'scale(1)' }]
      : [{ transform: 'scale(.92)' }, { transform: 'scale(1)' }], { duration: (saving ? MS.starPress : MS.starRelease) * pace, easing: saving ? 'cubic-bezier(.3,.6,.4,1)' : EASE.glide }));
    return true;
  }
  if (!canMorph(from, to)) {
    // Different drawings (the loud speaker and the silent one): what the two share (the speaker's body) stays still; the outgoing
    // strokes fade out under the incoming ones, which draw in. Never a cut, never a blank icon.
    const changed = paths.map((_, i) => !source[i] || !target[i] || source[i].d !== target[i].d);
    outgoing(svg, group, source.filter((_, i) => changed[i] || !target[i]), MS.mediaOut * pace);
    let n = 0; paths.forEach((path, i) => { if (changed[i]) draw(svg, path, MS.mediaMorph * pace, 60 * pace * n++); });
    return true;
  }
  const duration = (slot === 'reload' ? (to === 'stop' ? MS.toStop : MS.toReload) : slot === 'sidebar' ? MS.sidebar : MS.mediaMorph) * pace;
  paths.forEach((path, i) => { if (source[i].d !== target[i].d) track(svg, path.animate([{ d: was[i] }, { d: `path("${target[i].d}")` }], { duration, easing: EASE.glide })); });
  // Reload <> Stop also turns a little with the morph, the way the arrow was already going: from -35 degrees to 0 going to Stop, from 35 to 0 coming back (the sample's).
  // An interrupted morph starts from the angle it has reached (the sample snaps to its start: a jump the brief's "never snaps" rules out).
  if (slot === 'reload') track(svg, group.animate([{ transform: turn !== 'none' ? turn : `rotate(${to === 'stop' ? -LINE_MOVE.reloadTurn : LINE_MOVE.reloadTurn}deg)` }, { transform: 'rotate(0deg)' }], { duration, easing: EASE.glide }));
  if (!isBusy(svg)) retire(svg);
  return true;
}

// ---- delegated events: one listener set for the whole page, no per-button handlers ----

const HOST = 'button,[role=button],a,[data-li-host]';
const hostOf = (target: EventTarget | null): Element | null => (target instanceof Element ? target.closest(HOST) : null);
const iconOf = (host: Element): SVGSVGElement | null => host.querySelector<SVGSVGElement>('svg.li-icon[data-li]');
const unavailable = (host: Element): boolean => host.matches(':disabled,[aria-disabled=true]');
const rests = new WeakMap<Element, HoverRest>();

function press(host: Element): void {
  if (unavailable(host)) return;
  const svg = iconOf(host); if (!svg) return;
  rests.get(host)?.press();
  playPress(svg);
}
function over(event: PointerEvent): void {
  if (event.pointerType === 'touch') return;
  const host = hostOf(event.target), svg = host && iconOf(host), name = svg && nameOf(svg);
  if (!host || !svg || !name || !HOVER_ICONS.has(name) || unavailable(host) || (event.relatedTarget instanceof Node && host.contains(event.relatedTarget))) return;
  let rest = rests.get(host);
  if (!rest) { rest = new HoverRest(() => { const live = iconOf(host); if (host.isConnected && live && !isBusy(live) && !unavailable(host)) playHover(live); }); rests.set(host, rest); }
  rest.enter();
  if (isAppearing(Number.parseFloat(getComputedStyle(host).opacity))) { rest.press(); const live = iconOf(host); if (live && !isBusy(live)) playHover(live); }   // still fading in: the draw is its appearance, now, not a second one after the rest
}
function out(event: PointerEvent): void {
  const host = hostOf(event.target); if (!host) return;
  if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return;
  rests.get(host)?.leave();
}

let installed = false;
/** Start listening (once per page). Runs when this module loads in a page (below), so no icon has to ask for it. */
export function installLineIconEvents(doc: Document = document): void {
  if (installed) return; installed = true;
  doc.addEventListener('pointerdown', event => { if (event.button === 0 && event.isPrimary) { const host = hostOf(event.target); if (host) press(host); } }, true);
  // Enter and Space reach a button as a click with no pointer (detail 0): the same behaviour, the same moment.
  doc.addEventListener('click', event => { if (event.detail === 0) { const host = hostOf(event.target); if (host) press(host); } }, true);
  doc.addEventListener('pointerover', over, true);
  doc.addEventListener('pointerout', out, true);
}

/** The icons that have a press / hover behaviour (a test keeps these equal to the policy in ui/lineMotion.ts). */
export const pressBehaviours = (): LineIconName[] => Object.keys(PRESS) as LineIconName[];
export const hoverBehaviours = (): LineIconName[] => Object.keys(HOVER) as LineIconName[];
if (typeof document !== 'undefined') installLineIconEvents();
