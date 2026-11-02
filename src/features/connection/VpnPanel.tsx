import { useLayoutEffect, useRef, useState } from 'react';
import type { VpnCommand, VpnProviderId, VpnProviderStatus, VpnState } from '../../runtime/vpn';
import { runtime } from '../../runtime/client';
import { ChevronDown, Network } from '../../components/AppIcons';
import { t, useT, type MessageId } from '../../i18n';
import { useVpn } from './useVpn';
import './vpn.css';

const stateIds: Record<VpnState, MessageId> = {
  connected: 'vpn.control.connected', disconnected: 'vpn.control.disconnected', connecting: 'vpn.control.connecting',
  disconnecting: 'vpn.control.disconnecting', paused: 'vpn.control.paused', error: 'vpn.control.error', unknown: 'vpn.control.unknown',
};
function description(provider: VpnProviderStatus) {
  if (!provider.installed) return t('setup.vpn.line.notInstalled');
  if (!provider.verified) return t('vpn.control.unverified');
  if (provider.id === 'proton') return t('vpn.control.protonApp');
  return t(stateIds[provider.state]);
}

/** Shared provider actions in setup, ordinary Settings and the toolbar popup. Provider state is never inferred from a running process. */
export function VpnPanel({ compact = false, setup = false, onNavigate }: { compact?: boolean; setup?: boolean; onNavigate?: (url: string) => void }) {
  useT();
  const vpn = useVpn();
  const panel = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<VpnProviderId | null>(null);
  const [chosen, setChosen] = useState<VpnProviderId | null>(null);
  const selected = chosen ?? vpn.status?.providers.find(provider => provider.canConnect || provider.canDisconnect)?.id ?? 'proton';
  const openSite = (url: string) => onNavigate ? onNavigate(url) : void runtime.dispatch({ type: 'tab.new', url });
  useLayoutEffect(() => {
    if (vpn.busy || !pendingFocus.current) return;
    const provider = pendingFocus.current; pendingFocus.current = null;
    // Restore after React commits the replacement/enabled button, rather than before an awaited state update paints.
    const until = performance.now() + 600;
    const restore = () => {
      const root = panel.current;
      if (!root || document.activeElement !== document.body) return;
      // Native material preparation can briefly make its content inert after the action changes its natural height.
      if (!root.closest('[inert]')) root.querySelector<HTMLButtonElement>(`[data-provider="${provider}"] button:not(:disabled)`)?.focus({ preventScroll: true });
      if (document.activeElement === document.body && performance.now() < until) requestAnimationFrame(restore);
    };
    restore();
  }, [vpn.busy, vpn.status]);
  const btn = compact ? "acira-button acira-button-secondary" : undefined;
  const command = (provider: VpnProviderId, action: VpnCommand) => {
    pendingFocus.current = provider;
    void vpn.command(provider, action);
  };
  return <div ref={panel} className="vpn-panel" data-compact={compact || undefined} data-setup={setup || undefined}>
    <p className="vpn-note">{t('vpn.control.scope')}</p>
    {!vpn.status && <p className="vpn-note" role="status">{t('vpn.control.reading')}</p>}
    {vpn.status?.providers.map(provider => <section className="vpn-provider" data-provider={provider.id} key={provider.id} aria-label={provider.name}>
      {setup ? <button type="button" className="vpn-provider-pick" aria-expanded={selected === provider.id} onClick={() => setChosen(provider.id)} title={t(('vpn.note.' + provider.id) as MessageId)}><strong>{provider.name}</strong><span className="vpn-state" data-state={provider.state}>{provider.id === 'proton' && provider.canOpen ? t('vpn.control.configure') : description(provider)}</span><ChevronDown size={12} aria-hidden="true" /></button> : <div className={compact ? "vpn-provider-title acira-menu-row acira-menu-row-fact" : "vpn-provider-title"}>{compact && <Network size={16} className="acira-menu-icon" />}<strong className={compact ? "acira-menu-title" : undefined} title={t(('vpn.note.' + provider.id) as MessageId)}>{provider.name}</strong><span className={compact ? "vpn-state acira-menu-value" : "vpn-state"} data-state={provider.state}>{description(provider)}</span></div>}
      {!compact && !provider.installed && <p className="vpn-note">{t(('vpn.note.' + provider.id) as MessageId)}</p>}
      {(!setup || selected === provider.id) && <>
      {provider.blocked && <p className="vpn-note vpn-warning">{t('vpn.control.blocked')}</p>}
      <div className="vpn-actions">
        {provider.canConnect && <button type="button" className={btn} disabled={vpn.busy} onClick={() => void command(provider.id, 'connect')} title={t('vpn.control.connectTip')}>{t('vpn.control.connect')}</button>}
        {provider.canDisconnect && <button type="button" className={btn} disabled={vpn.busy} onClick={() => void command(provider.id, 'disconnect')} title={t('vpn.control.disconnectTip')}>{t('vpn.control.disconnect')}</button>}
        {provider.canOpen && <button type="button" className={btn} disabled={vpn.busy} onClick={() => void command(provider.id, 'open')} title={t('vpn.control.configureTip')}>{t('vpn.control.configure')}</button>}
        {!provider.canOpen && <button type="button" className={btn} onClick={() => openSite(provider.site)} title={t('vpn.control.siteTip')}>{provider.installed ? t('vpn.control.website') : t('setup.vpn.get')}</button>}
        <button type="button" className={compact ? "vpn-help acira-button acira-button-quiet" : "vpn-help"} onClick={() => openSite(provider.help)} title={t('vpn.control.helpTip')}>{t('vpn.control.help')}</button>
      </div>
      </>}
    </section>)}
    {vpn.problem && <p className="vpn-note vpn-warning" role="alert">{vpn.problem}</p>}
    {!setup && <p className="vpn-note">{t('vpn.control.routing')}</p>}
    {!compact && <p className="vpn-note">{t('vpn.control.independent')}</p>}
    <button type="button" className={compact ? "vpn-refresh acira-button acira-button-quiet" : "vpn-refresh"} disabled={vpn.busy} onClick={() => void vpn.refresh()}>{t('vpn.control.refresh')}</button>
  </div>;
}
