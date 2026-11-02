import type { Rectangle } from '../runtime/types';

type Seekable = { playState: string; currentTime: CSSNumberish | null; effect: { getComputedTiming(): { endTime?: CSSNumberish } } | null };
type Box = { x: number; y: number; width: number; height: number };
/** The parts of an element settledBox touches (a real HTMLElement has them all; tests pass plain objects). */
export type SettlingElement = {
  parentElement: SettlingElement | null;
  style: { transform: string };
  matches(selector: string): boolean;
  getBoundingClientRect(): Box;
  /** A tab strip scrolling to a goal publishes it while the tween runs (BrowserTabsHorizontal, CompactTabs moveScroll). */
  scrollLeft?: number;
  dataset?: { scrollGoal?: string; scrollGoalUntil?: string };
};

/** Strip items whose position Framer's layout projection animates with an inline transform (BrowserTabsHorizontal, CompactTabs). */
const PROJECTED = '.tab-flow';

/** Where an element will be once its motion settles: its layout box without the FLIP motion still carrying it there (R6: a new
 * tab group's menu opens on the very next frame, next to where the group's chip or header ends up, instead of waiting for it
 * to stop moving). Running finite animations in the page (the sidebar's WAAPI FLIP and arrival, the strip's width and margin
 * transitions) are seeked to their end and a strip item's projection transform on the element or an ancestor is lifted; the box is read; then every
 * animation and transform is put back in the same task, so nothing is painted in between. Static transforms (the toolbar's
 * own position) are kept: they are not animations and not strip items. */
export function settledBox(node: SettlingElement, animations: () => Seekable[] = () => (globalThis.document?.getAnimations?.() ?? []) as Seekable[], now: () => number = () => performance.now()): Rectangle {
  const seeked: [Seekable, Seekable['currentTime']][] = [], lifted: [SettlingElement, string][] = [];
  try {
    // Every running animation in the page, not only the element's own: in the strip a new chip is carried into place by
    // its neighbours' width and margin transitions (measured: 540 -> 486 px over 600 ms), which are not on it or its ancestors.
    // Reading the box first brings styles up to date, so transitions that start with this render are in the list.
    node.getBoundingClientRect();
    for (const animation of animations()) {
      if (animation.playState !== 'running' && animation.playState !== 'paused') continue;
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end !== 'number' || !Number.isFinite(end)) continue;
      seeked.push([animation, animation.currentTime]);
      animation.currentTime = end;
    }
    for (let el: SettlingElement | null = node; el; el = el.parentElement) {
      if (el.matches(PROJECTED) && el.style.transform && el.style.transform !== 'none') {
        lifted.push([el, el.style.transform]);
        el.style.transform = 'none';
      }
    }
    const box = node.getBoundingClientRect();
    // A strip still scrolling to its goal: the item ends up shifted by what is left of the scroll.
    let shift = 0;
    for (let el: SettlingElement | null = node.parentElement; el; el = el.parentElement) {
      const goal = Number(el.dataset?.scrollGoal), until = Number(el.dataset?.scrollGoalUntil);
      if (el.dataset?.scrollGoal !== undefined && Number.isFinite(goal) && until > now()) shift += (el.scrollLeft ?? 0) - goal;
    }
    return { x: box.x + shift, y: box.y, width: box.width, height: box.height };
  } finally {
    for (const [el, transform] of lifted.reverse()) el.style.transform = transform;
    for (const [animation, time] of seeked.reverse()) animation.currentTime = time;
  }
}
