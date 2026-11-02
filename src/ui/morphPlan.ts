import { springAt, type SpringSpec } from './springs';

/** The pure part of the morph sweep (R3-70, docs/launch/MORPH_INVENTORY.md): what a list or a disclosure changes, and the
 * state of a glide in flight. No DOM, so Node tests load it. `sharedMotion.ts` draws it (`glideBy`, `useListMotion`,
 * `morphDisclosure`). */
export interface Box { x: number; y: number; w: number; h: number }

/** What moved between two layouts of the same elements (keyed by anything: a React key, an element). Positions are in
 * layout space, never as painted, so an element mid-flight does not look moved. */
export interface ListPlan<K> { glide: Map<K, { dx: number; dy: number }>; enter: K[]; leave: Array<[K, Box]> }
export function planList<K>(before: ReadonlyMap<K, Box>, after: ReadonlyMap<K, Box>, threshold = 1): ListPlan<K> {
  const plan: ListPlan<K> = { glide: new Map(), enter: [], leave: [] };
  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was) { plan.enter.push(key); continue; }
    const dx = was.x - now.x, dy = was.y - now.y;
    if (Math.abs(dx) + Math.abs(dy) >= threshold) plan.glide.set(key, { dx, dy });
  }
  for (const [key, was] of before) if (!after.has(key)) plan.leave.push([key, was]);
  return plan;
}

/** A glide: an element drawn `from` away from its layout place that settles to it on a spring. `pv` is the launch
 * velocity of the progress (1 → 0 of the offset), in 1/s. The offset is `from · (1 − p(t))`, so the velocity is
 * `−from · p′(t)`. */
export interface Glide { fromX: number; fromY: number; startedAt: number; spec: SpringSpec; pv: number }
export interface GlideState { x: number; y: number; vx: number; vy: number }
export const atRest: GlideState = { x: 0, y: 0, vx: 0, vy: 0 };

/** Where a glide is, and how fast it is moving, `now` ms on the clock its `startedAt` is on. */
export function glideAt(glide: Glide, now: number): GlideState {
  const t = Math.max(0, (now - glide.startedAt) / 1000), { value, velocity } = springAt(glide.spec, 0, 1, t, glide.pv);
  return { x: glide.fromX * (1 - value), y: glide.fromY * (1 - value), vx: -glide.fromX * velocity, vy: -glide.fromY * velocity };
}

/** The next glide when the layout place moved by `shift` (previous place − new place) while the element was drawn at
 * `current`: it is drawn where it is plus the shift, and keeps its speed, projected on the new direction. */
export function glideStart(current: GlideState, shift: { x: number; y: number }): { fromX: number; fromY: number; pv: number } {
  const fromX = current.x + shift.x, fromY = current.y + shift.y, size = fromX * fromX + fromY * fromY;
  // offset(t) = from · (1 − p): the progress speed that reproduces the incoming speed along the new direction.
  const pv = (size > 1e-9 ? -(current.vx * fromX + current.vy * fromY) / size : 0) + 0;
  return { fromX, fromY, pv };
}

/** A glide this small is already where it is going. */
export const negligible = (start: { fromX: number; fromY: number }, tolerance = .5): boolean => Math.hypot(start.fromX, start.fromY) < tolerance;

/** A disclosure (an accordion, a details element) opens by revealing its content from the top while everything below it
 * slides down by the same amount, on one spring, so the content's lower edge and the next element's top edge are the
 * same line all the way. Closing runs it backwards on a still of the content. `height` is the content's height. The clip
 * keeps `bleed` px beyond the content at the sides and the bottom once open, so rings and shadows are never cut. */
export const disclosureFrames = (height: number, bleed = 8): { collapsed: string; open: string } => ({
  collapsed: `inset(0px ${-bleed}px ${Math.max(0, Math.round(height * 100) / 100)}px ${-bleed}px)`,
  open: `inset(0px ${-bleed}px ${-bleed}px ${-bleed}px)`,
});
