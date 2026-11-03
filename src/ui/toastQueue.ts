import type { BrowserSnapshot, ToastAction } from '../runtime/types';

/** Bible §4 Toast: at most three on screen, newest at the bottom; each row is 44px with a 1px rule between rows. */
export const toastLimit = 3, toastRowHeight = 44;
export interface QueuedToast { key: number; id: number; text: string; action?: ToastAction; tone?: 'error' | 'info';
  /** The profile on screen when it came. With profiles as spaces another profile can come on screen in the same window (otherSpaceToasts). */
  profileId?: string }
type Incoming = NonNullable<BrowserSnapshot['toast']>;

/** The same undo batch ("2 tabs closed" after "Tab closed"), or the same plain text, updates its row instead of stacking. */
const sameToast = (row: QueuedToast, toast: Incoming) => row.action || toast.action
  ? JSON.stringify(row.action?.command) === JSON.stringify(toast.action?.command)
  : row.text === toast.text;

/** Adds main's newest toast. Returns the new list, the row's key (its timer), and the keys pushed past the limit. */
export function pushToast(list: QueuedToast[], toast: Incoming, profileId?: string): { list: QueuedToast[]; key: number; dropped: number[] } {
  const same = list.find(row => sameToast(row, toast)), key = same ? same.key : toast.id;
  // Status toasts never reach the stack (they go to the pill lane), so only error/info tones are kept here.
  const entry: QueuedToast = { key, id: toast.id, text: toast.text, action: toast.action, ...(toast.tone === 'error' || toast.tone === 'info' ? { tone: toast.tone } : {}), ...(profileId ? { profileId } : {}) };
  const next = same ? list.map(row => row === same ? entry : row) : [...list, entry];
  return { list: next.slice(-toastLimit), key, dropped: next.slice(0, Math.max(0, next.length - toastLimit)).map(row => row.key) };
}

/** Undo rows whose batch has left closed tabs (undone from the toast, Ctrl+Shift+T or another window) are spent. */
export const spentToasts = (list: QueuedToast[], closedTabs: BrowserSnapshot['closedTabs']) => list.filter(row => {
  const command = row.action?.command;
  return command?.type === 'tab.restore.batch' && !closedTabs.some(tab => tab.closedBatch === command.id);
}).map(row => row.key);

/** Profiles as spaces: the rows that came while another profile was on screen (`profileId` '' once it is turned off). They leave when the
 *  space changes: a "Tab closed · Undo" left behind would reopen the other space's tab and jump back to it (QA #8). Rows of a window
 *  with workspaces have no profile and never leave this way. */
export const otherSpaceToasts = (list: QueuedToast[], profileId: string) => list.filter(row => row.profileId !== undefined && row.profileId !== profileId).map(row => row.key);

/** Errors and notices stay until dismissed or timed out and carry a × (bible §4); plain confirmations do not. */
export const dismissible = (tone?: string) => tone === 'error' || tone === 'info';

export const toastStackHeight = (rows: number) => rows * toastRowHeight + Math.max(0, rows - 1);

/** The room the native toast host keeps: it grows with the list in the same render and shrinks only when `kept` (the delayed copy) lets go.
 *  Reading the delayed copy alone left a new toast's first render with no room (a 0×0 host layout that main rejects). */
export const toastRoom = <T,>(list: T[], kept: T[]): T[] => list.length >= kept.length ? list : kept;

/** Main closes the toast overlay on a resize, a blur, a move, a click in the page and when a popup opens and closes over it, and from then on
 *  refuses that overlay id and every older one (createOverlayGuard). A host that sat over a website then holds a dead id: its rows are off
 *  screen for good, so they leave the list too. Left in, an error (it has no timer) kept the dead id for the whole session and no toast
 *  showed over a website again. In the page (an Acira page) nothing is hosted by main and nothing is lost. */
export const toastHostRefused = (overWebsite: boolean, hostId: number | undefined, dismissedId: number | undefined) =>
  overWebsite && hostId !== undefined && dismissedId !== undefined && dismissedId >= hostId;

/** The rows that show exactly `text`: a notice that is only true while something holds (Seamless's first-use tip) leaves with it. */
export const toastKeysSaying = (list: QueuedToast[], text: string) => list.filter(row => row.text === text).map(row => row.key);
