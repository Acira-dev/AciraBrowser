import { defineSettings } from '../model';

import { t } from '../../../i18n';
/** Stream G · UF-026 offline game, rendered by `panels/offline-game.tsx`. */
export default defineSettings('About', [
  // Beta 14.4: the Insider code row, below the Offline game as in 13.11 (panels/offline-game.tsx InsiderCodeRow). Not in a private or Tor window, where the programme is not offered.
  { id: 'insider-code', title: t('insider.code.label'), group: 'Extras', description: t('settings.insiderCodeDetail'), signpost: true, aliases: ['insider', 'insider code', 'code', 'key', 'code key', 'activation', 'activation code', 'activate', 'beta', 'invite', 'invite code'], when: 'regular-profile' },
  { id: 'offline-game', title: t("offlineGame.offlineGame"), group: 'Extras', description: t("offlineGame.aSmallDotMatrixGame"), aliases: ['dino', 'dinosaur', 'game', 'no internet', 'offline', 'starship', 'easter egg'] },
]);
