import { defineSettings } from '../model';

import { t } from '../../../i18n';
export default defineSettings('Connection', [
  { id: 'tor-level', title: t("tor.level.settingTitle"), group: 'Tor', description: t("tor.level.overview"), aliases: ['security level', 'safer', 'safest', 'standard', 'tor javascript', 'tor webassembly', 'tor jit', 'tor browser'] },
  { id: 'tor-onion-prefer', title: t("tor.onion.prefer"), group: 'Tor', description: t("tor.onion.preferDetail"), aliases: ['onion location', 'onion', 'prioritize onion', 'tor onion site'] },
]);
