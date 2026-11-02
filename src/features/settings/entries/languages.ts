import { defineSettings } from '../model';

import { t } from '../../../i18n';
/** Interface language, rendered by `panels/languages.tsx`. */
export default defineSettings('Languages', [
  { id: 'interface-language', title: t("language.title"), group: 'Language', description: t("language.detail"), aliases: ['languages', 'idioma', 'langue', 'sprache', 'translate', 'locale', 'interface language', 'display language'] },
]);
