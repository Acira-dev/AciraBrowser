/**
 * Beta 14 (smoothness B6): a tab is chosen on the mouse PRESS, as Chromium's tab strip does (chrome/browser/ui/views/tabs/tab.cc, Tab::OnMousePressed:
 * a left press without modifiers selects the tab; a drag then starts from the same press). Acira chose tabs on the click (the release), so every switch
 * waited for the person's hold, 80-120 ms on a real click, before anything moved. The compact strip already chose on press (CompactTabs downSelect);
 * the sidebar rows and the horizontal strip now follow the same rule.
 *
 * What stays on the click (or never selects):
 * - anything but a plain left press of a MOUSE: middle (closes), right (menu), a modifier held, touch and pen (a touch press may be the start of a scroll);
 * - a press on a control inside the tab (close, mute, actions);
 * - the tab that is already active;
 * - while a split is on screen, a tab outside it: dragging it into one of the panes must not first replace the split with its page
 *   (the reason the horizontal strip had waited for the click, 26 Oct).
 * A drag from the press keeps working: reorder only moves the tab; a drop that opens a split pairs the dragged tab with the most recent other tab
 * (splitDrop.ts splitDropAction), which is the tab that was active before the press.
 */
export interface PressSelectInput {
  button: number;
  pointerType: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  /** The press landed on a control inside the tab (close, mute, an action button). */
  onControl: boolean;
  tabId: string;
  activeTabId: string;
  /** The tab ids of the split on screen, if one is. */
  shownSplit?: readonly string[] | null;
}

export function selectsOnPress(p: PressSelectInput): boolean {
  if (p.button !== 0 || p.pointerType !== 'mouse') return false;
  if (p.ctrlKey || p.metaKey || p.shiftKey || p.altKey) return false;
  if (p.onControl || p.tabId === p.activeTabId) return false;
  if (p.shownSplit && p.shownSplit.length && !p.shownSplit.includes(p.tabId)) return false;
  return true;
}

/** One press per tab: the click that ends a press which already chose the tab does nothing more. */
export function createPressMemo() {
  let pressed: string | null = null;
  return {
    /** The press chose `tabId`. */
    chose(tabId: string) { pressed = tabId; },
    /** A new press that did not choose anything. */
    clear() { pressed = null; },
    /** The click of `tabId`: true when its press already chose it (the click must not choose again); the memo is spent either way. */
    spentBy(tabId: string) { const was = pressed === tabId; pressed = null; return was; },
  };
}
