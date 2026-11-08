import type { MessageId } from '../i18n';
import type { SidebarSize } from '../runtime/sidebarSizes';

/** The names of the three sidebar sizes, as catalog ids (Settings › Tabs › Sidebar, the edge's menu, the edge's spoken value). */
export const SIZE_NAME_ID: Record<SidebarSize, MessageId> = { narrow: 'sidebar.sizeNarrow', standard: 'sidebar.sizeStandard', wide: 'sidebar.sizeWide' };
