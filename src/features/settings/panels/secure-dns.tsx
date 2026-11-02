import { NativeNetworkSettings } from '../../NativeNetworkSettings';
import '../../../styles/native-network.css';
import type { SettingsPanel } from '../panels';

/** Settings › Connection › Secure DNS (R3-74: it was in Privacy, next to Global Privacy Control; the lookups that find sites are part of how Acira connects). */
function SecureDns() {
  return <NativeNetworkSettings part="dns" />;
}

const panel: SettingsPanel = { section: 'Connection', icon: 'tabs', order: 9, Component: SecureDns };
export default panel;
