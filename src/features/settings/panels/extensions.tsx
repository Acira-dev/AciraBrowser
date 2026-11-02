import { ExtensionManager } from '../../../components/ExtensionManager';
import { SettingGroup, SettingNote, SettingRow } from '../controls';
import type { SettingsPanel, SettingsPanelProps } from '../panels';

import { t } from '../../../i18n';
/** Chrome Web Store install and extension management. The manager itself lives in components/ExtensionManager. */
const STORE_URL = 'https://chromewebstore.google.com/category/extensions';

function Extensions({ state, dispatch }: SettingsPanelProps) {
  const profile = state.browserProfiles.find((item) => item.id === state.activeBrowserProfileId);
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  return (
    <SettingGroup>
      <SettingRow id="extensions-manager" title={t("privacy.chromeWebStoreExtensions")} detail={t("ext.settingsDetail")} stacked />
      {profile && <ExtensionManager profileId={profile.id} profileName={profile.name} tab={tab} privateMode={Boolean(profile.private)} onGetExtensions={() => dispatch({ type: 'tab.new', url: STORE_URL })} />}
      <SettingNote>{t("extensions.signInToBitwardenInside")}</SettingNote>
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'Extensions', icon: 'extensions', order: 30, Component: Extensions };
export default panel;
