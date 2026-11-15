import type { FocusEvent, KeyboardEvent } from 'react';

/** 13.10 (a user: "no suggestions come up on the search bar in the new tab; they do come up in the address bar").
 *
 * The New Tab page's search box is the same `AddressField` as the toolbar's, but only the toolbar's was ever wired to the suggestion
 * list. The box is now the second text field that list serves: the window (App.tsx) ranks the same rows for the box's text
 * (`rankAddressSuggestions`), draws the same list (the native overlay or the local popup) under the box, and answers the same keys
 * (arrows, Enter, Shift+Enter, Esc, Tab, Shift+Delete on a history row). Nothing here ranks, draws or decides what may be shown:
 * the privacy lines, the setting that turns suggestions off and the engine rules all stay where they were. */

/** The box that is typed in right now. The page hands it over when the box takes the keyboard and at every edit. */
export interface NewTabField {
  /** The tab whose page this box is on. */
  tabId: string;
  /** What the box holds now: the text the list answers. */
  text: string;
  input: HTMLInputElement;
  /** The search box the list hangs from (`.nt-search`). */
  box: HTMLElement;
  /** The page's own draft: Tab's completion writes through it, so the draft the tab keeps is what the box shows. */
  setText(next: string): void;
}

/** What the window gives the page for its search box. */
export interface NewTabSuggest {
  /** The "address suggestions" setting: off, and the box behaves as it did before 13.10. */
  enabled: boolean;
  /** The list is open for this box right now (`aria-expanded`). */
  open: boolean;
  listId: string;
  activeId?: string;
  /** The box took the keyboard. Focus alone opens nothing: only typing, or an arrow key, does (as in the address field). */
  focus(field: NewTabField): void;
  /** The box's text changed (typing, a paste, an input method): the list opens, follows the text, or closes on an empty box. */
  change(field: NewTabField): void;
  /** A key in the box: true when the list took it. */
  key(event: KeyboardEvent<HTMLInputElement>): boolean;
  /** The box lost the keyboard for good (the field's own parking of a blur that is only the view's has already been applied). */
  blur(event: FocusEvent<HTMLInputElement>): void;
  /** Only the interface's view has been away from the keyboard for the list's grace: the list closes, the text stays. */
  viewBlur(): void;
  /** The page went away (another tab, a navigation, the search switched off) with the box still registered. */
  leave(): void;
}

/** The class of the box the list hangs from; the window's pointer rule and the list's anchor read it. */
export const NEW_TAB_BOX = '.nt-search';

/** The box is the field the list answers while the setting is on, and only on the tab the window shows (the rows are ranked from the shown tab's side of every privacy line). */
export const newTabFieldServed = (field: NewTabField | null, shownTabId: string, enabled: boolean): field is NewTabField => enabled && field !== null && field.tabId === shownTabId;

/** The search box the keyboard is in, when it is: the list of a typed-in box hangs from it. `document.activeElement` stays the field while only the view has lost the keyboard (the list's own view has it for a moment). */
export const newTabBoxOf = (active: Element | null): HTMLElement | null => active?.closest?.<HTMLElement>(NEW_TAB_BOX) ?? null;

/** A blur ends the list unless the keyboard moved to a popup's own trigger (the address field's rule, now shared with the box). */
export const blurKeepsList = (next: EventTarget | null): boolean => next instanceof Element && next.closest('[data-popup-trigger]') !== null;
