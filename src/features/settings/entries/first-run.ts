import { defineSettings } from '../model';

import { t } from '../../../i18n';
/** Stream F (first run + profiles). Anchors live in src/features/accounts/ProfileManager.tsx. */
export default defineSettings('Profiles', [
  { id: 'profile-edit', title: t("firstRun.renameAProfile"), group: 'Your profiles', description: t("firstRun.changeAProfileSName"), aliases: ['rename profile', 'profile name', 'profile color', 'avatar', 'change name', 'edit profile'], when: 'desktop' },
  { id: 'profile-remove', title: t("firstRun.removeAProfile"), group: 'Your profiles', description: t("firstRun.deleteAProfileAndIts"), aliases: ['delete profile', 'remove user', 'erase profile', 'remove account'], anchor: 'profile-edit', when: 'desktop' },
]);
