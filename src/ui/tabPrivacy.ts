import type { TabSession } from '../runtime/types';

/**
 * The privacy mark a tab wears in the strip, sidebar and lists. A tab of a secured workspace (R3-38, `privacy: 'secured'`) wears
 * none: every tab there is secured, and the workspace's lock badge says so once, so a private-tab mark on each would be noise
 * (and wrong: its session is shared with the workspace, not its own).
 */
export const shownPrivacy = (tab: Pick<TabSession, 'privacy'>): 'private' | 'tor' | undefined => tab.privacy === 'secured' ? undefined : tab.privacy;
