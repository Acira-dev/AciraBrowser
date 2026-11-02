import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { ProxySettings } from './privacy';

/** Settings › Connection › Proxy: how this profile reaches the internet (R3-74: it was in Privacy; "how Acira connects" is Connection). */
function Proxy({ state }: SettingsPanelProps) {
  const profile = state.browserProfiles.find((item) => item.id === state.activeBrowserProfileId);
  return <ProxySettings key={state.activeBrowserProfileId} disabled={Boolean(profile?.private)} />;
}

const panel: SettingsPanel = { section: 'Connection', icon: 'tabs', order: 8, Component: Proxy };
export default panel;
