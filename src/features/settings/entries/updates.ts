import { defineSettings } from '../model';

import { t } from '../../../i18n';
export default defineSettings('About', [
  { id: 'app-updates', title: t("updates.checkForUpdates"), group: 'Updates', description: t("updates.versionUpdateStatusAndRestart"), aliases: ['update', 'upgrade', 'new version', 'version', 'restart to update', 'latest version', 'release'], when: 'desktop' },
  { id: 'app-updates-auto', title: t("updates.downloadUpdatesAutomatically"), group: 'Updates', description: t("updates.checksAtLaunchAndEvery"), aliases: ['auto update', 'automatic updates', 'background updates', 'turn off updates'], when: 'desktop' },
]);
