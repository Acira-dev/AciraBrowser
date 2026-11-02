import { defineSettings } from '../model';

import { t } from '../../../i18n';
export default defineSettings('Connection', [
  { id: 'tor-update', title: t("connection.keepTorUpToDate"), group: 'Tor', description: t("connection.checksTheTorProjectOnce"), aliases: ['tor auto update', 'tor version', 'onion', 'tor browser'] },
  { id: 'tor-update-check', title: t("connection.checkForATorUpdate"), group: 'Tor', description: t("connection.lookForANewerTor"), aliases: ['update tor'] },
  { id: 'tor-bridges', title: t("connection.bridges.mode"), group: 'Bridges', description: t("connection.bridges.note"), aliases: ['bridge', 'bridges', 'obfs4', 'snowflake', 'meek', 'webtunnel', 'pluggable transport', 'tor blocked', 'censorship'] },
]);
