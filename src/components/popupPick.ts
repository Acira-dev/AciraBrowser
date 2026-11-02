/** Which row a pointer click in a popup "picks" (the 80ms confirm blink, then the click is replayed on the row).
 *
 * The blink swallows the real click and replays `row.click()` on the ROW. That is right when the row itself is what the
 * person clicks (a menu button, a menuitem) and wrong when a control sits inside a plain row div: a switch, a button, a
 * link, a field. The replay then lands on the wrapper, which has no handler, and the control never answers a real
 * click (R3 feature proof: "Block ads and trackers on this site" ignored real mouse clicks, while a script click, which
 * has detail 0 and never enters the blink, worked). A click whose nearest control is not the row is left alone.
 *
 * Structural types only, so the rule is testable without a DOM. */
export const PICK_ROWS = '.menu-row,.acira-menu-row,[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';
/** Rows that handle their own state or open something: no blink. */
export const PICK_SKIP = ':disabled,[aria-disabled="true"],[aria-expanded],[aria-haspopup],[aria-checked],summary';
/** Anything a person can operate on its own. */
export const PICK_CONTROLS = 'a[href],button,input,select,textarea,label,summary,[contenteditable="true"],[role="button"],[role="switch"],[role="checkbox"],[role="radio"],[role="slider"],[role="spinbutton"],[role="link"],[role="tab"],[role="option"],[tabindex]:not([tabindex="-1"])';

export interface PickNode {
  closest?(selector: string): PickNode | null;
  matches(selector: string): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contains(other: any): boolean;
}

/** The row to blink and replay for a click on `target` inside `root`, or null when the click must go through untouched. */
export function pickRowFor<T extends PickNode>(target: T | null, root: T | null): T | null {
  const row = (target?.closest?.(PICK_ROWS) ?? null) as T | null;
  if (!row || !root || !root.contains(row) || row.matches(PICK_SKIP)) return null;
  // A control nested in the row owns this click. The row only picks when the nearest control is the row itself (or there is none).
  const control = (target?.closest?.(PICK_CONTROLS) ?? null) as T | null;
  if (control && control !== row && row.contains(control)) return null;
  return row;
}
