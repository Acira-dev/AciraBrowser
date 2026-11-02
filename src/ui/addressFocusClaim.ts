/** A new blank tab claims the address field for its first moments: once the toolbar is on screen the field is focused and its
 * text selected (useNewTabReveal). That claim is spent the moment the person takes the field themselves (Ctrl+L, typing, Esc,
 * the command bar). Without that, a claim that was still waiting for the toolbar to show re-focused and re-selected the field
 * a moment after Ctrl+L, so the first letters typed were overwritten by the next ones ("ndard fixture input"). */
export type FocusClaim = string | null;

/** Whether the claim for `tabId` is taken now, and what is left of it. A claim is taken once, only for its own tab, only while the toolbar shows. */
export function takeFocusClaim(claim: FocusClaim, tabId: string, toolbarShown: boolean): { focus: boolean; claim: FocusClaim } {
  if (!toolbarShown || claim !== tabId) return { focus: false, claim };
  return { focus: true, claim: null };
}

/** Ctrl+T, then Ctrl+L and typing at once: main already made the new tab active, but the chrome paints it a frame later (up to 100 ms in a
 * window that draws no frames), so the field was taken, and typed in, while the last tab was still on screen. When that switch is painted,
 * the field the person is in and the letters they typed belong to the new tab: they are kept, not blurred and reset like a tab change. */
export function carriesAddressDraft({ takenFor, tabId, previousTabId, editedTab, focused }: { takenFor: string | null; tabId: string; previousTabId: string; editedTab: string | null; focused: boolean }): boolean {
  return focused && tabId !== previousTabId && takenFor === tabId && editedTab === previousTabId;
}

/** The person has taken the field themselves: nothing is left to claim. */
export const releaseFocusClaim = (): FocusClaim => null;

/** Native shortcuts cross IPC. Input delivered after the shortcut was requested
 * already belongs to the person's new edit; a late select would erase its prefix. */
export function addressRequestIsCurrent(requestedAt: number | undefined, edit: {tabId:string;at:number} | null, tabId: string): boolean {
  return requestedAt === undefined || !edit || edit.tabId !== tabId || edit.at < requestedAt;
}
