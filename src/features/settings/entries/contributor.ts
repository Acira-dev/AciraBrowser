import { defineSettings, type SettingsEntry } from '../model';
import { t } from '../../../i18n';

/** Beta 14: the contributor controls (src/features/settings/panels/contributor.tsx). */
const entries: SettingsEntry[] = defineSettings('Profiles', [
  { id: 'contributor-show', title: t('feedback.settings.show'), group: t('feedback.settings.group'), description: t('feedback.settings.show.detail'), aliases: ['badge', 'my badge', 'contributor badge', 'login badge', 'log in', 'login', 'sign in for the badge', 'account', 'points', 'rank', 'ranks', 'ring', 'contributor', 'early member', 'notes'] },
  { id: 'contributor-ranks', title: t('feedback.settings.ranks'), group: t('feedback.settings.group'), description: t('feedback.settings.ranks.detail'), aliases: ['view ranks', 'insider', 'trusted contributor', 'contributor'] },
  { id: 'contributor-delete', title: t('feedback.settings.delete'), group: t('feedback.settings.group'), description: t('feedback.settings.delete.detail'), aliases: ['delete contributor', 'contributor key', 'remove my data', 'points'] },
]);
export default entries;
