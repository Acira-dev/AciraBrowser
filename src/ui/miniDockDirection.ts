/**
 * The layout switch between the Mini rail and the docked sidebar (the toggle, the shortcut, the menu, "Keep open"): which way it goes and how far the rail's box stands from the docked sidebar's.
 *
 * The Mini sidebar is one live picture in a view transition (the float and the hover never cross-fade pictures), but the dock plays the normal sidebar's slide from the rail's edge (miniRail.css, `[data-mini-dock]`).
 * The transition's group sits at the NEW state's box, so the OLD picture is drawn shifted by the distance between the two boxes: the rail's box stands 6px in from the window on the left and 190px (the docked width less
 * the rail's 50) from its page-side edge on the right. `--mini-dock-dx` is that signed distance (rail box x minus docked box x, CSS px) and the keyframes undo it.
 */
export const MINI_DOCK_ATTR = 'data-mini-dock';
export const MINI_DOCK_DX = '--mini-dock-dx';
export const miniDockDirection = (was: boolean, now: boolean): 'in' | 'out' | '' => (was === now ? '' : now ? 'in' : 'out');
/** The signed distance (rail box x - docked box x) from the box that stood before the switch and the one that stands after it. */
export const miniDockDx = (direction: 'in' | 'out', before: number, after: number): number => (direction === 'in' ? before - after : after - before);
export type MiniDockSnapshot = { docked: boolean; x: number; phase?: string };
/** The Mini sidebar as it stands now: docked or not, its phase (rail, open, closing: the float's own states), and where its box starts. Null with no Mini sidebar (the normal sidebar, Hidden). */
export const miniDockSnapshot = (): MiniDockSnapshot | null => {
  const aside = typeof document === 'undefined' ? null : document.querySelector('.acira-sidebar.is-mini');
  return aside ? { docked: aside.classList.contains('is-mini-docked'), x: aside.getBoundingClientRect?.().x ?? 0, phase: (aside as HTMLElement).dataset?.mini ?? '' } : null;
};
/** After the switch's update ran (inside the transition's callback): marks the direction on the root, and the boxes' distance, while the transition plays. */
export function noteMiniDock(was: MiniDockSnapshot | null): void {
  if (typeof document === 'undefined') return;
  const now = miniDockSnapshot();
  // From the rail only: a switch that starts with the hover float OPEN (or closing: "Keep open" on the float, a click on its tab) already shows the full sidebar, which stays where it is while the page glides to it.
  const fromRail = was !== null && (was.docked || !was.phase || was.phase === 'rail');
  const direction = was === null || now === null || !fromRail ? '' : miniDockDirection(was.docked, now.docked);
  const root = document.documentElement;
  if (direction && root.hasAttribute('data-mode-switch') && was && now) {
    root.setAttribute(MINI_DOCK_ATTR, direction);
    root.style.setProperty(MINI_DOCK_DX, `${Math.round(miniDockDx(direction, was.x, now.x) * 100) / 100}px`);
  } else clearMiniDock();
}
export function clearMiniDock(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.removeAttribute(MINI_DOCK_ATTR); root.style.removeProperty(MINI_DOCK_DX);
}
/** D194 (reported 25 Nov: "a flash from sidebar to minibar the flash is like smthn dimming the icons for a sec then repaering when going from side to mini"): miniRail.css starts the rail's entrance (its rows from
 * nothing to whole over 12 % to 30 % of a collapse, and their 6 px glide) on the page's mark of a collapse (`data-mini-dock=out` on the root), and holds it off with the sidebar's own mark of the switch. A switch that ended
 * before the page's mark went (its 1500 ms net) took the sidebar's mark off first: the entrance started anew over the landed rail and every rail icon went to nothing and came back. The landed rail now keeps a mark of its
 * own until the page's mark has gone, under the same hold. Nothing changes when the page's mark goes first (the normal end). */
export const MINI_DOCK_DONE = 'data-mini-dock-done';
export function holdDockDone(el: Element, root: Element = document.documentElement): void {
  if (!root.hasAttribute(MINI_DOCK_ATTR) || typeof MutationObserver === 'undefined') return;
  el.setAttribute(MINI_DOCK_DONE, '');
  const off = new MutationObserver(() => { if (!root.hasAttribute(MINI_DOCK_ATTR)) { off.disconnect(); el.removeAttribute(MINI_DOCK_DONE); } });
  off.observe(root, { attributes: true, attributeFilter: [MINI_DOCK_ATTR] });
}
