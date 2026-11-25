import type { TabSession } from '../runtime/types';

/** The command the play / pause button sends: a playing tab is paused, a paused one plays. (Which tabs have a card, and in what
 * order, is ui/nowPlaying.ts `orderCards`.) */
export const mediaToggle = (tab: Pick<TabSession, 'id' | 'media'>) => ({ type: 'media' as const, tabId: tab.id, action: tab.media === 'playing' ? 'pause' as const : 'play' as const });
