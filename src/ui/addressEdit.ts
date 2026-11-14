/** What the person typed in the address field wins (13.8, a Windows report: "the search bar cuts back between what I typed a second ago
 * and what I'm typing now"). The rules are Chromium's omnibox, ported in Acira's terms:
 *  - components/omnibox/browser/omnibox_edit_model.cc  OmniboxEditModel::ResetDisplayTexts (when a new address may replace the text) and
 *    OmniboxEditModel::OnKillFocus (losing focus does not end the edit: user_input_in_progress stays);
 *  - chrome/browser/ui/views/omnibox/omnibox_view_views.cc  OmniboxViewViews::Update (with focus, the new text is selected in full),
 *    OmniboxViewViews::OnBlur (the selection is saved, the popup closes) and OnFocus (the saved selection comes back).
 * What Electron changes: Chromium's omnibox and the page are views of one window; here the field lives in the interface's own web contents,
 * so "the field lost focus" has two cases the page can tell apart. When the interface's view loses the keyboard (a press on the suggestion
 * list, which is its own view; a page main handed the keyboard to; another window), the field stays the document's focused element and gets
 * a blur with no related target while the document has no focus: that is a blur of the view, not of the field. */

/** `view`: only the interface's view lost the keyboard while the person has an edit (they typed: user_input_in_progress); the edit and its
 *  selection are kept until focus comes back (or the field is left).
 *  `left`: the field itself lost focus (a click elsewhere in the interface, Esc, Enter, a script's blur()), or nothing was typed: as before
 *  (OnKillFocus with no user input goes back to the page's address). */
export type AddressBlur = 'view' | 'left';
export function addressBlur({ relatedTarget, documentHasFocus, fieldStillFocused, edited }: { relatedTarget: unknown; documentHasFocus: boolean; fieldStillFocused: boolean; edited: boolean }): AddressBlur {
  return edited && !relatedTarget && !documentHasFocus && fieldStillFocused ? 'view' : 'left';
}

/** A blur of the view that outlived the suggestion list's grace (a press on the list hands the keyboard straight back, SUGGESTION_FOCUS_GRACE_MS):
 *  still the focused element -> the list closes (OmniboxViewViews::OnBlur -> CloseOmniboxPopup) and the edit stays; no longer the focused
 *  element (the interface took the field away while its view was away: a click on the page, a tab change, Esc call blur(), which fires no
 *  event in a document without focus) -> the edit ends now. */
export function afterViewBlurGrace(fieldStillFocused: boolean): 'close-list' | 'left' {
  return fieldStillFocused ? 'close-list' : 'left';
}

/** A new address for the tab on screen (it navigated, or a site rewrote its own address): ResetDisplayTexts + Update.
 *  - The person has begun editing (Acira: the tab's draft while the field is in use): their text stays (user_input_in_progress).
 *  - The field is in use and the suggestion list is open: the text stays too (Chromium: !PopupIsOpen()).
 *  - Otherwise the new address replaces the text, and if the field is in use it is selected in full (SelectAll), so the next letter replaces
 *    it. Before 13.8 the selection was lost with the old text, so a click on the field of a site that rewrites its address (a single-page
 *    site, a search results page) and then typing added the letters to the end of the new address.
 *  null: nothing to change. */
export function addressOnNewUrl({ shown, current, editing, focused, listOpen }: { shown: string; current: string; editing: boolean; focused: boolean; listOpen: boolean }): { text: string; selectAll: boolean } | null {
  if (editing) return null;
  if (focused && listOpen) return null;
  if (shown === current) return null;
  return { text: shown, selectAll: focused };
}
