import type { TabSession } from './types';

/** The longest name a person can give a tab. Page titles are not capped here (a website can send what it likes). */
export const TAB_NAME_MAX = 120;

/** What the person typed, made storable: one line, single spaces, trimmed, capped. Empty means "no custom name". */
export function cleanTabName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TAB_NAME_MAX).trim();
}

/** The title every tab surface shows: the name the person gave the tab, else the page's own title. */
export const tabDisplayTitle = (tab: Pick<TabSession, 'title' | 'customTitle'>): string => (tab.customTitle && tab.customTitle.trim()) || tab.title;

/** The tab as a surface draws it: the custom name takes the title's place and the page's own title rides along as
 * `pageTitle` (the rename field's placeholder, the hover card's quiet line). A tab with no custom name is returned as it is. */
export function shownTab<T extends Pick<TabSession, 'title' | 'customTitle'>>(tab: T): T & { pageTitle?: string } {
  const name = tab.customTitle && tab.customTitle.trim();
  return name ? { ...tab, title: name, pageTitle: tab.title } : tab;
}

/** A tooltip for a renamed tab names it as renamed (the one place the strip and sidebar show it), e.g. "Project board · Renamed". */
export const renamedTip = (tab: { pageTitle?: string }, text: string | undefined, marker: string): string | undefined => (text !== undefined && tab.pageTitle !== undefined ? `${text} · ${marker}` : text);

/** What a rename field saves (an action's title), or null when nothing changes: the same name again. An empty field, or
 * the page's own title typed back, saves "" which takes the custom name away. */
export function renameOutcome(tab: Pick<TabSession, 'title' | 'customTitle'>, typed: string): string | null {
  const name = cleanTabName(typed);
  const next = !name || name === tab.title ? '' : name;
  return next === (tab.customTitle ?? '') ? null : next;
}
