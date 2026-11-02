import type { SettingsPanel } from '../panels';
import { SettingGroup, SettingRow, Switch } from '../controls';
import { setOfflineGameEnabled, useOfflineGameEnabled } from '../../../components/offline-game/OfflineGame';

import { t } from '../../../i18n';
function OfflineGameSettings() {
  const enabled = useOfflineGameEnabled();
  return (
    <SettingGroup title={t("offlineGame.extras")} id="offline-page" fold>
      <SettingRow id="offline-game" title={t("offlineGame.offlineGame")} detail="When there is no internet, the error page offers a small dot-matrix game. It stays still until you press Space.">
        <Switch label={t("offlineGame.offlineGame")} checked={enabled} onChange={setOfflineGameEnabled} />
      </SettingRow>
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'About', order: 200, Component: OfflineGameSettings };
export default panel;
