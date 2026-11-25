import { defineSettings } from '../model';

import { t } from '../../../i18n';
/** Zap's list of removed parts (panels/zap.tsx). The anchor matches the `id` on the group there. It is not limited to regular profiles: a private or Tor window keeps its own removals in memory and lists them here. */
export default defineSettings('Privacy', [
  { id: 'zap-removed', title: t('zap.settings.title'), description: t('zap.settings.detail'), aliases: ['zap', 'zap element', 'remove element', 'remove part of page', 'removed parts', 'removed elements', 'hide element', 'hide part of page', 'block element', 'element zapper', 'cookie banner', 'annoying parts', 'restore removed part', 'undo zap', 'clear removed parts', 'hidden parts'], group: 'Parts removed with Zap', section: 'Protection' },
]);
