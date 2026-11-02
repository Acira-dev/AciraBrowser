import { defineSettings } from '../model';

import { t } from '../../../i18n';
/** Stream G · F52 installed web apps, rendered by `panels/web-apps.tsx`. */
export default defineSettings('Web apps', [
  { id: 'web-app-install', title: t("webApps.installASiteAsAn"), group: 'Install', description: t("webApps.giveAWebsiteItsOwn"), aliases: ['pwa', 'progressive web app', 'install app', 'web app', 'shortcut', 'desktop shortcut', 'start menu', 'app window'] },
  { id: 'web-apps', title: t("webApps.installedApps"), group: 'Installed apps', description: t("webApps.openOrUninstallTheSites"), aliases: ['uninstall app', 'remove app', 'pwa', 'web apps'] },
]);
