import type { MessageId } from '../i18n';
import type { TabsLayout } from './sidebarMode';

/** The catalog id of each Tabs answer's name: the words the Settings cards, the menu's tips and Make it yours all use. */
export const tabsLayoutName: Record<TabsLayout, MessageId> = { top: 'yours.tabsTop', 'top-sidebar': 'yours.tabsTopSide', sidebar: 'yours.tabsSide', 'sidebar-address': 'yours.tabsSideAddress' };
