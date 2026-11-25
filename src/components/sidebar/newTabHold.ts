/** A new tab that "new tabs at the top" shows under the New tab row at once (AciraSidebar's SidebarTabs). The model is reordered a moment later:
 *  the sidebar asks for it (`tab.drop`, before the first old tab) and the answer comes back as the next state. In between, the tab is in the model's
 *  list at the END. The list used to forget that the tab was new on the very next render (its set of known tabs grows in the effect that asks for the
 *  move), so any state that arrived first (the page starting to load, a title, a favicon) drew the row at the bottom for a frame or two, and then
 *  the move arrived and drew it at the top again (Beta 14: the open animation was cut, and flashed at the bottom).
 *
 *  The hold remembers, for each tab asked to move, the tab it was moved in front of (`anchor`) and when. The tab keeps its place at the top for as long
 *  as the model has it BELOW its anchor, so the moment the move has really happened the hold is over by itself; a hold also ends when the anchor is gone
 *  or after HOLD_MS (a move that never came: the list then shows the model as it is). Pure. */
import { appendedTabs } from './sidebarActions';
export interface NewTabHold { anchor: string; at: number }
/** A move that has not arrived within this long is given up. */
export const HOLD_MS = 2000;

export const tabsWaitingAtTop = <T extends { id: string }>(loose: readonly T[], holds: ReadonlyMap<string, NewTabHold>, now: number): T[] => {
  if (!holds.size) return [];
  const place = new Map(loose.map((tab, index) => [tab.id, index] as const));
  return loose.filter(tab => {
    const hold = holds.get(tab.id);
    if (!hold || now - hold.at > HOLD_MS || now < hold.at) return false;
    const anchor = place.get(hold.anchor);
    return anchor !== undefined && place.get(tab.id)! > anchor;
  });
};

/** What a render shows at the top: `fresh` (just arrived at the end), `waiting` (asked to move a moment ago, the model not there yet) and `appended`
 *  (both, in the list's order; the sidebar draws them newest first, ahead of the other tabs). `previous` is every tab the last render knew. */
export const newTabsAtTop = <T extends { id: string }>(loose: readonly T[], previous: ReadonlySet<string> | null, reopened: ReadonlySet<string>, listed: readonly T[], holds: ReadonlyMap<string, NewTabHold>, now: number, on: boolean) => {
  const fresh = on && previous ? appendedTabs(loose, previous, reopened, listed) : [], waiting = on ? tabsWaitingAtTop(loose, holds, now) : [];
  return { fresh, waiting, appended: loose.filter(tab => fresh.includes(tab) || waiting.includes(tab)) };
};

/** The tab a fresh batch of new tabs is moved in front of: the newest of the tabs still waiting at the top (the list shows them first, newest first),
 *  else the first tab that was already here. */
export const frontOf = <T extends { id: string }>(waiting: readonly T[], oldTop: string): string => waiting.length ? waiting[waiting.length - 1].id : oldTop;

/** The moves to ask for, and the holds that go with them: `fresh` in list order, each in front of the one before it (the first in front of `front`), which is
 *  how the model ends up newest first. Also forgets holds of tabs that are gone. */
export const planMoves = (holds: Map<string, NewTabHold>, fresh: readonly { id: string }[], front: string, now: number, present: ReadonlySet<string>): { from: string; to: string }[] => {
  for (const id of [...holds.keys()]) if (!present.has(id) || now - holds.get(id)!.at > HOLD_MS) holds.delete(id);
  const moves: { from: string; to: string }[] = [];
  let anchor = front;
  for (const tab of fresh) { holds.set(tab.id, { anchor, at: now }); moves.push({ from: tab.id, to: anchor }); anchor = tab.id; }
  return moves;
};
