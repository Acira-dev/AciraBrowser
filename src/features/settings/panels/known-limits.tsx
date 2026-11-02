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
        detail="Protected streaming requires a supported browser build and service. Supported Mac builds prepare Widevine automatically when online. Availability and video quality vary by service and device; other builds may not support protected playback."
      />
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'About', order: 60, Component: KnownLimits };
export default panel;
