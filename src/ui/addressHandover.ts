import { sizeOf } from '../runtime/sidebarSizes';

/**
 * D179 (member, 24 Nov; the team's picks 10:3x): with the address bar in the sidebar at Narrow (168), the field shows 17 characters of an address
 * while it is edited, so a click in it, or Ctrl/Cmd+L, hands the edit over to Command search, opened as it opens today (its place, its motion), with the
 * whole current address in it, selected. Standard and Wide keep the field.
 *
 * What a person typing a NEW address keeps (CommandPalette.tsx, `address` mode):
 *   - typing a site, or pasting a link, and Enter goes there, in this tab (whatever "Command search opens in a new tab" says);
 *   - Alt+Enter opens it in a new tab;
 *   - Esc closes it: the field was never touched, the page is as it was;
 *   - arrowing (or pointing) onto a row and Enter runs that row, as Command search does.
 * What is lost against the field: inline completion (the rest of an address typed ahead), and the field's own suggestion list and order (Command search
 * lists tabs, history and commands its own way).
 */
/** Command search is opened for the address with the current tab's id as its context (its own opening has none). A tab id is what main accepts as a
 * popup's context: an id of another kind ('address') was refused and nothing opened. */
export const handoverFor = (contextId: string | undefined, tabId: string): boolean => !!contextId && contextId === tabId;

export const addressHandsOver = (input: { wanted: boolean; sidebarWidth: unknown }): boolean => input.wanted && sizeOf(input.sidebarWidth) === 'narrow';

/** The text Command search opens with: the page's address, nothing for a New Tab. */
export const handoverText = (url: string | undefined): string => (!url || url.startsWith('acira://new') ? '' : url);

/** Enter in Command search opened for the address: a row the person moved onto runs as a row; otherwise what is typed is an address (here, or a new tab with Alt). */
export type HandoverEnter = 'row' | 'here' | 'new-tab';
export const handoverEnter = (input: { moved: boolean; alt: boolean; query: string }): HandoverEnter => (input.moved || !input.query.trim() ? 'row' : input.alt ? 'new-tab' : 'here');
