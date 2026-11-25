import type { AddressSuggestion } from './addressSuggestions';

/**
 * Beta 14, section O: the address suggestions list, made clear. Row design A was decided by the team (13 Nov): one line per row, the real site
 * icon, the title with the typed part bold, the site only when it fits whole, and the type of the row as one quiet icon at its end. The clock on
 * every history row turns into the x under the pointer (remove from history). B, C and a single "History" label were not chosen and are gone.
 */
/** OPEN (the team has not decided): does a click anywhere on an open tab's row switch to that tab? false = today's behaviour: the click opens the tab's
 *  address in the current tab, and only the tab mark at the row's end (or Shift+Enter) switches. Until decided, keep false. */
export const OPEN_TAB_ROW_CLICK_SWITCHES = false;

export interface SuggestionChoices { openTabRowSwitches: boolean }

/** QA only (remove with the constant above once the team has chosen): `localStorage['acira-suggestion-rows']` holds `{"openTabRowSwitches":true}`. */
export const SUGGESTION_OVERRIDE_KEY = 'acira-suggestion-rows';
export function suggestionChoices(storage: Pick<Storage, 'getItem'> | undefined = (() => { try { return globalThis.localStorage; } catch { return undefined; } })()): SuggestionChoices {
  const choices: SuggestionChoices = { openTabRowSwitches: OPEN_TAB_ROW_CLICK_SWITCHES };
  try {
    const raw = storage?.getItem(SUGGESTION_OVERRIDE_KEY);
    const value = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (value && typeof value === 'object' && typeof value.openTabRowSwitches === 'boolean') choices.openTabRowSwitches = value.openTabRowSwitches;
  } catch { /* an unreadable override is no override */ }
  return choices;
}

/** A row's height and the list's own padding (4px above and below). */
export const ROW_HEIGHT = 36;
export const LIST_PADDING = 8;
export const rowTop = (index: number): number => index * ROW_HEIGHT;

/** Beta 14: the search engine's suggestions are a group of their own under the person's rows, with a quiet label (the service's name) above its first row. */
export const GROUP_HEIGHT = 30;
type Kinded = Pick<AddressSuggestion, 'kind'>;
/** Where the group's label sits: the index of its first row, or -1 when the list has no engine suggestions. */
export const groupStart = (items: readonly Kinded[]): number => items.findIndex(item => item.kind === 'suggestion');
/** A row's top, with the group's label taken into account (rows under it sit GROUP_HEIGHT lower). */
export const rowTopIn = (items: readonly Kinded[], index: number): number => { const start = groupStart(items); return index * ROW_HEIGHT + (start >= 0 && index >= start ? GROUP_HEIGHT : 0); };

/** The height the popup is asked for: its rows, the group label and the padding. An empty list keeps one row of room. `items` may be the list or just its row count. */
export const suggestionsListHeight = (items: number | readonly Kinded[]): number => {
  const count = typeof items === 'number' ? items : items.length, group = typeof items === 'number' ? 0 : groupStart(items) >= 0 ? GROUP_HEIGHT : 0;
  return LIST_PADDING + Math.max(1, count) * ROW_HEIGHT + group;
};

/** Does a click on the row (not on a button inside it) switch to the open tab it names? Only a tab row can, and only when the OPEN choice above says so. */
export const rowClickSwitchesTab = (item: Pick<AddressSuggestion, 'kind'>, choices: Pick<SuggestionChoices, 'openTabRowSwitches'>): boolean => choices.openTabRowSwitches && item.kind === 'tab';

/** The identity a row has for motion: its own id, as the approved sample has it (item17 AddressSuggestions.tsx: `placed` is a map of item.id to top). A row whose id is new, or
 *  whose top changed, re-forms in its slot with the blur-and-fade; a row that stays put does not move. The typed row's id carries the typed text (`search:sad`), so it re-forms with
 *  every key, exactly as in the sample (EXACT SAMPLE PARITY, 14 Nov: an earlier build gave it one fixed identity so it never re-formed; that was ours, not the sample's). */
export const motionIdOf = (item: Pick<AddressSuggestion, 'kind' | 'id'>): string => item.id;

/** The site shown after the title: the host, never the path. Searches and answers say what they are; a command has none.
 *  Nothing when the title already is the address or the host. */
export function suggestionSite(item: Pick<AddressSuggestion, 'kind' | 'title' | 'url' | 'detail'>, alike = false): string {
  if (item.kind === 'suggestion') return '';   // the group's label already names the service
  if (item.kind === 'search' || item.kind === 'answer') return item.detail;
  if (item.kind === 'command') return '';
  const plain = item.url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  let host = plain;
  try { host = new URL(item.url).hostname.replace(/^www\./i, '') || plain; } catch { /* not a URL: the address as stored */ }
  const title = item.title.trim().toLocaleLowerCase();
  if (title === plain.toLocaleLowerCase()) return '';
  // 14.4: a row that reads like another (same title, same site) shows where it differs: the address, host and path (even when its title is the host).
  if (alike) return plain;
  return title === host.toLocaleLowerCase() ? '' : host;
}

/** The rows of a list that would read the same (the same title on the same site, whatever kind of row), by id. The host alone cannot tell them apart, so their site line carries the path too
 *  (`suggestionSite(item, true)`); every other row keeps its host-only line. Only rows with a web address can be alike. */
export function readAlike(items: readonly Pick<AddressSuggestion, 'id' | 'kind' | 'title' | 'url'>[]): Set<string> {
  const seen = new Map<string, string[]>();
  for (const item of items) {
    if (item.kind !== 'tab' && item.kind !== 'history' && item.kind !== 'bookmark') continue;
    let host = '';
    try { host = new URL(item.url).hostname.replace(/^www\./i, '').toLocaleLowerCase(); } catch { continue; }
    const key = `${item.title.trim().toLocaleLowerCase()}\n${host}`;
    seen.set(key, [...seen.get(key) ?? [], item.id]);
  }
  return new Set([...seen.values()].filter(ids => ids.length > 1).flat());
}

/** The host a stored site icon is filed under (the History page's rule): the address's host without "www.", lower case, web pages only. */
export function iconHostOf(url: string): string {
  try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; }
}
