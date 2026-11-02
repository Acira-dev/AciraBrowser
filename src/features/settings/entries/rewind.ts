import { defineSettings, type SettingsEntry } from '../model';

import { t } from '../../../i18n';
/** Stream H (rewind) controls. Anchors live in settings/panels/rewind.tsx. */
const entries: SettingsEntry[] = defineSettings('Tabs', [
  { id: 'rewind-enabled', title: t("browsermenu.rewind"), group: 'Rewind', description: t("rewind.settingsDetail"), aliases: ['privacy', 'restore tabs', 'lost tabs', 'recover tabs', 'closed tabs', 'recently closed', 'reopen tab', 'closed group', 'checkpoint', 'saved windows', 'session backup', 'undo close window'] },
  { id: 'rewind-retention', title: t("rewind.keepFor"), group: 'Rewind', description: t("rewind.keepForDetail"), aliases: ['retention', 'how long', 'days', 'rewind history'] },
  { id: 'rewind-clear', title: t("rewind.deleteHistory"), group: 'Rewind', description: t("rewind.deleteHistoryDetail"), aliases: ['clear rewind', 'delete closed tabs', 'remove saved windows'] },
]);
export default entries;
