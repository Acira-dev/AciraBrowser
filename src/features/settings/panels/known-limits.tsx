import { SettingGroup, SettingRow } from '../controls';
import type { SettingsPanel } from '../panels';

import { t } from '../../../i18n';
/** What Acira cannot do yet, said plainly. The notice that appears on a site that needs Widevine opens here. */
function KnownLimits() {
  return (
    <SettingGroup title={t("knownLimits.streamingServicesThatNeedDrm")} id="known-limits-group" fold>
      <SettingRow
        id="known-limits"
        title={t("knownLimits.streamingServicesThatNeedDrm")}
        detail={t("knownLimits.streamingDetail")}
      />
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'About', order: 60, Component: KnownLimits };
export default panel;
