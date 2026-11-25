import { useLayoutEffect, useRef, type RefObject } from 'react';
import { FOLDER_EASE } from './folderGlyph';

/** Beta 14, section M: the two things about a folder's tabs that CSS cannot do alone.
 *
 *  1. The guide line beside the folder's tabs retracts upward as the folder closes (the opening draws it downward in CSS, folders.css). The sidebar's fold
 *     (`useFlip` in AciraSidebar.tsx) takes the rows out at once and fades pictures of them, so the real line has no height left; a copy of the line at the
 *     folder's open height retracts over the same time as the fading rows, on the draw curve, and goes.
 *  2. When a folder opens, its new rows must not show through rows that are still sliding: the rows below the folder start where they were and slide down on
 *     the spring, while the new rows already stand in the slots they are sliding into (13.6 let them overlap for about 150 ms). The folder's rows are uncovered by an
 *     edge that travels with the row below: a clip on the rows' box whose bottom edge starts at the folder's old end and moves down on the very animation
 *     (delay, duration, curve) that slides the row below it, so a row is only ever drawn above the row that is still on its way.
 *
 *  Speed Off (and reduced motion) is instant: there is no animation to cover and nothing is started. */

const scaleOf = (node: Element) => { const value = parseFloat(getComputedStyle(node).getPropertyValue('--motion-scale')); return Number.isFinite(value) ? Math.max(0, value) : 1; };
/** The line's length of retract when no fading row sets it: the same units as the opening (folders.css: 173 x --motion-scale ms). */
export const RAIL_UNITS = 173;
/** Only a height change this soon after the folder opened is an unfold; later growth (a tab added to an open folder) is not covered. */
const UNFOLD_WINDOW_MS = 250;

export function useFolderRail(root: RefObject<HTMLElement | null>, collapsed: boolean) {
  const was = useRef<boolean | null>(null), openHeight = useRef(0), openedAt = useRef(-1e9), height = useRef(0);
  // While the folder is open, remember how tall its tabs are: that is the length of the line that retracts when it closes.
  useLayoutEffect(() => {
    const group = root.current, members = group?.querySelector<HTMLElement>(':scope>.sb-group-members');
    if (!group || !members) return;
    if (!collapsed && members.offsetHeight > 0) openHeight.current = members.offsetHeight;
    const before = was.current; was.current = collapsed;
    if (before === false && collapsed) retract(group, members, openHeight.current);
    if (before === true && !collapsed) { openedAt.current = performance.now(); clearCopies(members); }
  }, [collapsed, root]);
  // One observer: remembers the open height as rows settle, and starts the uncover when the first change after an unfold arrives (the rows are laid
  // out and the sidebar's own slide of the rows below has started by then, so its timing can be copied).
  useLayoutEffect(() => {
    const group = root.current;
    if (!group || typeof ResizeObserver === 'undefined') return;
    height.current = group.offsetHeight;
    const watch = new ResizeObserver(() => {
      const now = group.offsetHeight, from = height.current; height.current = now;
      const members = group.querySelector<HTMLElement>(':scope>.sb-group-members');
      if (members && !group.hasAttribute('data-collapsed') && members.offsetHeight > 0) openHeight.current = members.offsetHeight;
      if (members && now - from > .5 && from >= 0 && performance.now() - openedAt.current < UNFOLD_WINDOW_MS) uncover(group, members, now - from);
    });
    watch.observe(group);
    return () => watch.disconnect();
  }, [root]);
}

function clearCopies(members: HTMLElement) { members.querySelectorAll(':scope>.fg-rail-copy,:scope>.fg-conn-copy').forEach(node => node.remove()); }

function retract(group: HTMLElement, members: HTMLElement, height: number) {
  const scale = scaleOf(group);
  if (!scale || !height || group.hasAttribute('data-holds-active')) return; // Off: nothing to draw; a folder still holding the current tab keeps its line
  clearCopies(members);
  // A group that holds groups retracts its whole connector (the trunk and the curves, drawn at the open height): a copy of it is the thing that goes. The copy is taken now, while
  // the connector still has its open drawing.
  const connector = group.hasAttribute('data-has-inner') ? members.querySelector<HTMLElement>(':scope>.sb-group-rail') : null;
  const rail = connector ? connector.cloneNode(true) as HTMLElement : document.createElement('i');
  rail.classList.add(connector ? 'fg-conn-copy' : 'fg-rail-copy');
  rail.setAttribute('aria-hidden', 'true');
  rail.style.height = height + 'px';
  if (connector) { rail.style.bottom = 'auto'; rail.style.clipPath = 'inset(0 0 0 0)'; rail.style.transition = 'none'; }
  members.appendChild(rail);
  // item05 railRetract: it retracts over exactly the leaving pictures' fade (the last delay + duration among them), else 173 units, on the draw curve. The pictures are made by the
  // sidebar's FLIP pass, which runs after this group's own layout effect: they are read a microtask later, still before the frame is painted.
  queueMicrotask(() => {
    if (!rail.isConnected) return;
    const ghosts = [...document.querySelectorAll<HTMLElement>('.acira-sidebar .sb-flip-ghost')];
    const end = Math.max(0, ...ghosts.flatMap(node => node.getAnimations().map(item => { const t = item.effect?.getComputedTiming(); return (Number(t?.delay) || 0) + (Number(t?.duration) || 0); })));
    const animation = rail.animate([{ clipPath: connector ? 'inset(0 0 0 0)' : 'inset(0 0 0 0 round 1px)' }, { clipPath: connector ? 'inset(0 0 100% 0)' : 'inset(0 0 100% 0 round 1px)' }], { duration: end || RAIL_UNITS * scale, easing: FOLDER_EASE, fill: 'forwards' });
    const done = () => rail.remove();
    animation.finished.then(done, done);
  });
}

/** The rows below a folder slide on an animation the sidebar named `sb-flip`; find the first one next to the folder and copy its timing. */
function uncover(group: HTMLElement, members: HTMLElement, added: number) {
  let timing: { delay: number; duration: number; easing: string } | null = null;
  for (let next = group.nextElementSibling, i = 0; next && i < 3 && !timing; next = next.nextElementSibling, i++) {
    const slide = next.getAnimations({ subtree: true }).find(item => item.id === 'sb-flip'), t = slide?.effect?.getTiming(); // subtree: a folder below slides by its header row
    if (t) timing = { delay: Number(t.delay) || 0, duration: Number(t.duration) || 0, easing: String(t.easing) };
  }
  // item05 b14Folders.ts: with no sliding row to copy, the sample's own timing (90 units of delay when closing, 480 x min(scale, 1.28) long, the spring).
  timing ??= { delay: 0, duration: 480 * Math.min(scaleOf(group), 1.28), easing: String(getComputedStyle(group).getPropertyValue('--sb-spring') || 'ease') };
  if (!timing.duration) return;
  members.getAnimations().filter(item => item.id === 'fg-uncover').forEach(item => item.cancel());
  // item05: inset(0 -12px {growth}px -12px) -> inset(0 -12px 0 -12px)
  members.animate([{ clipPath: `inset(0 -12px ${added}px -12px)` }, { clipPath: 'inset(0 -12px 0 -12px)' }], { ...timing, id: 'fg-uncover', fill: 'backwards' });
}
