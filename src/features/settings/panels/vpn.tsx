import { VpnPanel } from '../../connection/VpnPanel';
import { SettingGroup, SettingRow } from '../controls';
import type { SettingsPanel } from '../panels';
import { t } from '../../../i18n';

function VpnSettings() {
  return <SettingGroup title={t('vpn.control.title')}><SettingRow id="vpn-controls" title={t('vpn.control.title')} stacked><VpnPanel /></SettingRow></SettingGroup>;
}
const panel: SettingsPanel = { section: 'Connection', icon: 'tabs', order: 5, Component: VpnSettings };
export default panel;
