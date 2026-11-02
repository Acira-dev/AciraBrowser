import type { BrowserSnapshot,TabSession } from '../runtime/types';

/** The tabs that have a media row in the sidebar footer, in tab order: playing ones are not moved above paused ones, so a
 * row never jumps when its tab is paused. */
export const mediaTabs = (state: Pick<BrowserSnapshot, 'tabs'>): TabSession[] => state.tabs.filter(tab => tab.media === 'playing' || tab.media === 'paused');

/** The command a row's play/pause button sends: a playing tab is paused, a paused one plays. */
export const mediaToggle = (tab: Pick<TabSession, 'id' | 'media'>) => ({ type: 'media' as const, tabId: tab.id, action: tab.media === 'playing' ? 'pause' as const : 'play' as const });
