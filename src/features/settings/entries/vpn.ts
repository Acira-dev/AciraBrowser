import { defineSettings } from '../model';
import { t } from '../../../i18n';

export default defineSettings('Connection', [
  { id: 'vpn-controls', title: t('vpn.control.title'), group: t('vpn.control.title'), description: t('vpn.control.scope'), aliases: ['vpn', 'mullvad', 'ivpn', 'proton', 'connect', 'disconnect', 'tunnel'], when: 'desktop' },
]);
