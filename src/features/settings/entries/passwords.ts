import { isMac } from '../../../ui/platform';
import { defineSettings, type SettingsEntry } from '../model';

import { t } from '../../../i18n';
/** Stream H (passwords) controls. Anchors live in settings/panels/passwords.tsx. */
const entries: SettingsEntry[] = defineSettings('Passwords', [
  { id: 'passwords-offer', title: t("passwords.offerToSavePasswords"), group: 'Passwords', description: t("passwords.askToSaveAndFill"), aliases: ['save passwords', 'autofill', 'password manager', 'sign in', 'login', 'credentials', 'autosave'], when: 'desktop' },
  { id: 'passwords-list', title: t("passwords.savedPasswords"), group: 'Passwords', description: t(isMac()?"passwords.seeCopyEditOrDelete.mac":"passwords.seeCopyEditOrDelete"), aliases: ['view passwords', 'show password', 'copy password', 'edit password', 'delete password', 'weak password', 'reused password', 'password check'], when: 'desktop' },
  { id: 'passwords-add', title: t("passwords.addAPassword"), group: 'Passwords', description: t("passwords.saveASignInYourself"), aliases: ['new password', 'create login'], when: 'desktop' },
  { id: 'passwords-import', title: t("index.importPasswords"), group: 'Passwords', description: t("passwords.bringPasswordsFromChromeEdge"), aliases: ['csv', 'chrome passwords', 'edge passwords', 'brave passwords', 'bitwarden', 'move passwords'], when: 'desktop' },
  { id: 'passwords-export', title: t("index.exportPasswords"), group: 'Passwords', description: t(isMac()?"passwords.saveAllPasswordsToA.mac":"passwords.saveAllPasswordsToA"), aliases: ['csv', 'backup passwords'], when: 'desktop' },
  { id: 'passwords-never', title: t("passwords.neverSavedSites"), group: 'Passwords', description: t("passwords.sitesWhereAciraWonT"), aliases: ['never for this site', 'exceptions', 'blocked sites'], when: 'desktop' },
  { id: 'passwords-delete-all', title: t("passwords.deleteAllPasswords"), group: 'Passwords', description: t("passwords.removeEverySavedPasswordFrom"), aliases: ['clear passwords', 'erase passwords'], when: 'desktop' },
]);
export default entries;
