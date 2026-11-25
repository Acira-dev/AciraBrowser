import { defineSettings } from '../model';

import { t } from '../../../i18n';
export default defineSettings('About', [
  { id: 'app-updates', title: t("updates.checkForUpdates"), group: 'Updates', description: t("updates.versionUpdateStatusAndRestart"), signpost: true, aliases: ['update', 'updates', 'update acira', 'new version', 'latest version', 'update', 'upgrade', 'new version', 'version', 'restart to update', 'latest version', 'release'], when: 'desktop' },
  // Beta 14.4: Insider builds, drawn only for a profile it is offered to (panels/updates.tsx insider.channel.offered), so search lists it only then.
  { id: 'app-updates-insider', title: t('insider.settings.title'), group: 'Updates', description: t('insider.settings.detail'), aliases: ['insider', 'insider builds', 'insider channel', 'early builds', 'beta builds', 'beta'], when: 'insider-channel' },
  { id: 'app-updates-auto', title: t("updates.downloadUpdatesAutomatically"), group: 'Updates', description: t("updates.checksAtLaunchAndEvery"), aliases: ['auto update', 'automatic updates', 'background updates', 'turn off updates'], when: 'desktop' },
]);
