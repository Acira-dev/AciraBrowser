import { defineSettings } from '../model';

import { t } from '../../../i18n';
/** Script blocking per site (panels/site-scripts.tsx). Anchors match the `id` on each SettingRow there. */
export default defineSettings('Privacy', [
  { id: 'site-scripts-everywhere', title: t('siteScripts.everywhere'), group: 'Scripts', description: t('siteScripts.everywhereDetail'), aliases: ['javascript', 'js', 'noscript', 'script blocking', 'block scripts', 'allow list', 'allowlist', 'whitelist', 'block everywhere'], when: 'regular-profile' },
  { id: 'site-scripts-sites', title: t('siteScripts.blockedSites'), group: 'Scripts', description: t('siteScripts.detail'), aliases: ['javascript', 'js', 'noscript', 'script blocking', 'blocked sites', 'allowed sites', 'block scripts on a site', 'sites list'], when: 'regular-profile' },
]);
