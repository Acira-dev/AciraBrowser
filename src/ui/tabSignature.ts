import type { TabSession } from '../runtime/types';

/** The fields a strip row draws (its tab's look and its site icon). Rows are memoised (D's tab-click profile, Round 2):
 * main sends fresh tab objects with every snapshot, so a row compares this instead, and two rows with the same
 * signature render the same. */
export const tabSignature = (tab: TabSession, icon: string | undefined) => [tab.id, tab.title, tab.customTitle, tab.url, tab.favicon, icon, tab.pinned, tab.privacy, tab.sleeping, tab.capturing?.join(), tab.risk?.kind, tab.risk?.title, tab.risk?.detail, tab.loading, tab.contentKind, tab.error ? 1 : 0, tab.audible, tab.muted, tab.group, tab.zoom].join('\u0001');
