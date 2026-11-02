import { defineSettings, type SettingsEntry } from '../model';

import { t } from '../../../i18n';
/** Stream B (motion-chrome) controls. Toolbar layout, focus mode and sidebar-only tabs are registered in core.ts. */
const entries: SettingsEntry[] = defineSettings('Appearance', [
  { id: 'menu-customize', title: t("menucustomizer.title"), group: 'Menu', description: t("menucustomizer.detail"), aliases: ['three dots', 'acira menu', 'main menu', 'more tools', 'reorder menu', 'hide menu item', 'menu items', 'customize menu'] },
  { id: 'toolbar-customize', title: t("app.customizeToolbar"), group: 'Toolbar', description: t("motionChrome.showHideAndReorderToolbar"), aliases: ['toolbar buttons', 'reorder', 'rearrange', 'hide button', 'show button', 'downloads button', 'history button', 'split view button', 'extensions button', 'profile button', 'toolbar icons'] },
]).concat(defineSettings('Tabs', [
]));
export default entries;
