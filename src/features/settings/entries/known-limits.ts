import { defineSettings } from '../model';

import { t } from '../../../i18n';
export default defineSettings('About', [
  { id: 'known-limits', title: t("knownLimits.streamingServicesThatNeedDrm"), group: 'Not supported yet', description: t("knownLimits.netflixDisneyPrimeVideoAnd"), aliases: ['drm', 'widevine', 'netflix', 'spotify', 'disney', 'prime video', 'protected content', 'protected video', 'eme', 'streaming', 'will not play', 'known limits', 'limitations'] },
]);
