import { SettingGroup, SettingRow, Switch } from '../controls';
import type { SettingsPanel } from '../panels';
import { TorLevelControl, useTorLevel } from '../../tor/TorLevel';
import { useTorOnionPreference } from '../../tor/TorOnion';

import { t } from '../../../i18n';
/** Settings › Connection › Tor security level: Tor Browser's Standard / Safer / Safest. The same control as the Tor panel's (features/tor/TorLevel.tsx);
 * the choice is one Tor preference for every Tor window and tab, saved beside the Tor engine's data. */
function TorSecurity() {
  const model = useTorLevel(), onion = useTorOnionPreference();
  return <>
    <SettingGroup title={t('tor.level.settingTitle')}>
      <SettingRow id="tor-level" title={t('tor.level.title')} detail={t('tor.level.overview')} stacked>
        <TorLevelControl variant="settings" model={model}/>
      </SettingRow>
    </SettingGroup>
    <SettingGroup title={t('tor.onion.group')}>
      <SettingRow id="tor-onion-prefer" title={t('tor.onion.prefer')} detail={onion.problem || t('tor.onion.preferDetail')}>
        <Switch label={t('tor.onion.prefer')} checked={Boolean(onion.prefer)} disabled={onion.prefer === null} onChange={next => void onion.choose(next)}/>
      </SettingRow>
    </SettingGroup>
  </>;
}

const panel: SettingsPanel = { section: 'Connection', icon: 'tabs', order: 11, Component: TorSecurity };
export default panel;
