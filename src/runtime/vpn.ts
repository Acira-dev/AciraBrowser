export type VpnProviderId = 'mullvad' | 'proton' | 'ivpn';
export type VpnCommand = 'connect' | 'disconnect' | 'open';
export type VpnState = 'connected' | 'disconnected' | 'connecting' | 'disconnecting' | 'paused' | 'error' | 'unknown';
export interface VpnProviderStatus {
  id: VpnProviderId; name: string; site: string; help: string;
  installed: boolean; verified: boolean; canOpen: boolean; canConnect: boolean; canDisconnect: boolean;
  state: VpnState; blocked: boolean;
}
export interface VpnStatus { platform: string; busy: boolean; providers: VpnProviderStatus[] }
