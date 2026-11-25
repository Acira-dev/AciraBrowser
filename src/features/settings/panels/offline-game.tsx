import type { SettingsPanel } from '../panels';
import { SettingGroup, SettingRow, Switch } from '../controls';
import { setOfflineGameEnabled, useOfflineGameEnabled } from '../../../components/offline-game/OfflineGame';

import { useFeedbackView } from '../../../runtime/feedback';
import { openInsider } from '../../insider/insiderFlow';
import { t } from '../../../i18n';

/** Beta 14.4 (the team): in 13.11 the Insider code was entered in About › Extras, below the Offline game, and people were told to look there. This row is in the
 *  same place and opens the 14 line's own code flow, the one the profile menu's "Enter Insider code" opens (insiderFlow.ts openInsider('code')): no field of its own,
 *  no second request, nothing kept here. Shown where that menu row is (the programme is offered to this profile); a profile that already has a pass is told so. */
export function InsiderCodeRow() {
  const insider = useFeedbackView('settings').insider;
  if (!insider.available) return null;
  if (insider.insider) return <SettingRow id="insider-code" title={t('insider.code.label')} detail={t('settings.insiderAlready')} />;
  return (
    <SettingRow id="insider-code" title={t('insider.code.label')} detail={t('settings.insiderCodeDetail')}>
      <button type="button" className="st-button" onClick={() => void openInsider('code')}>{t('settings.insiderEnter')}</button>
    </SettingRow>
  );
}

function OfflineGameSettings() {
  const enabled = useOfflineGameEnabled();
  return (
    <SettingGroup title={t("offlineGame.extras")} id="offline-page" fold>
      <SettingRow id="offline-game" title={t("offlineGame.offlineGame")} detail={t("offlineGame.detail")}>
        <Switch label={t("offlineGame.offlineGame")} checked={enabled} onChange={setOfflineGameEnabled} />
      </SettingRow>
      <InsiderCodeRow />
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'About', order: 200, Component: OfflineGameSettings };
export default panel;
