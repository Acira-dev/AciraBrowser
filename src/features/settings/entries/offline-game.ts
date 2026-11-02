import { defineSettings } from '../model';

import { t } from '../../../i18n';
/** Stream G · UF-026 offline game, rendered by `panels/offline-game.tsx`. */
export default defineSettings('About', [
  { id: 'offline-game', title: t("offlineGame.offlineGame"), group: 'Extras', description: t("offlineGame.aSmallDotMatrixGame"), aliases: ['dino', 'dinosaur', 'game', 'no internet', 'offline', 'starship', 'easter egg'] },
]);
