import { useSyncExternalStore } from 'react';
import { runtime } from '../../runtime/client';
import type { TorVaultStatus } from '../../runtime/nativeCore';
import { t } from '../../i18n';

/** Tor vault (desktop/browser-services/tor-vault.cjs): bookmarks and last tabs from Tor, off by default, encrypted, read behind Windows Hello. */
export const TOR_VAULT_TRADEOFF = t('tor.vaultTradeoff');
type Reply = { torVault?: TorVaultStatus; saved?: 'saved' | 'already'; reopened?: number };
const call = (request: Record<string, unknown>): Promise<Reply> => {
  const native = (runtime as unknown as { native?: (request: Record<string, unknown>) => Promise<Reply> }).native;
  return native ? native(request) : Promise.reject(new Error('Tor needs the desktop app.'));
};
export const torVaultReason = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '') : t('tor.vaultFailed');

let current: TorVaultStatus | null = null, started = false;
const listeners = new Set<() => void>();
const publish = (next?: TorVaultStatus) => { if (!next) return; current = { enabled: next.enabled, available: next.available, hasItems: next.hasItems }; for (const l of listeners) l(); };
export const refreshTorVault = () => call({ type: 'tor.vault-status' }).then(r => publish(r.torVault), () => undefined);
function subscribe(listener: () => void) { listeners.add(listener); if (!started) { started = true; void refreshTorVault(); } return () => { listeners.delete(listener); }; }
export const useTorVault = (): TorVaultStatus | null => useSyncExternalStore(subscribe, () => current, () => null);

export const setTorVault = (enabled: boolean) => call({ type: 'tor.vault-set', enabled }).then(r => { publish(r.torVault); return r; });
export const bookmarkInTorVault = () => call({ type: 'tor.vault-bookmark' }).then(r => { publish(r.torVault); return r.saved; });
export const listTorBookmarks = () => call({ type: 'tor.vault-list' }).then(r => r.torVault?.bookmarks ?? []);
export const removeTorBookmark = (id: string) => call({ type: 'tor.vault-remove', id }).then(r => publish(r.torVault));
export const reopenTorTabs = () => call({ type: 'tor.vault-reopen' }).then(r => r.reopened ?? 0);
export const clearTorVault = () => call({ type: 'tor.vault-clear' }).then(r => publish(r.torVault));
