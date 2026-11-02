import { bookmarksOnTab,bookmarksTogglePatch } from '../runtime/browserChrome';
import type { BrowserAction,Settings,TabSession } from '../runtime/types';

import { t } from '../i18n';
export interface ToolbarVisibilityItem {
  id: 'bookmarksBar' | 'showHome' | 'showTabOverview' | 'toolbarLayout';
  label: string;
  checked: boolean;
  shortcut?: string;
  action: Extract<BrowserAction, { type: 'settings.update' }>;
}

/** Blank toolbar menus describe browser controls, never a page's bookmark state. */
export function toolbarVisibilityItems(settings: Settings,tab:Pick<TabSession,'url'|'contentKind'>={url:'acira://new',contentKind:'internal'}): ToolbarVisibilityItem[] {
  const items: ToolbarVisibilityItem[] = [
    { id: 'bookmarksBar', label: t("bookmarkmenu.showBookmarksBar"), checked: bookmarksOnTab(settings,tab), shortcut: 'Ctrl Shift B', action: { type: 'settings.update', patch: bookmarksTogglePatch(settings,tab) } },
    { id: 'showHome', label: t("core.showHomeButton"), checked: settings.showHome, action: { type: 'settings.update', patch: { showHome: !settings.showHome } } },
    {id:'showTabOverview',label:t("core.showTabViewer"),checked:settings.showTabOverview!==false,action:{type:'settings.update',patch:{showTabOverview:settings.showTabOverview===false}}},
  ];
  // The Compact toggle that lived here is one of four Window views now (the menu's View group, windowview.ts).
  return items;
}
