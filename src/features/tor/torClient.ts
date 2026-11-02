import { useSyncExternalStore } from 'react';
import { runtime } from '../../runtime/client';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { shortcutFor } from '../../ui/shortcutKeys';
import { t } from '../../i18n';

/** Private windows with Tor (stream N): status from desktop/browser-services/tor-window.cjs over the native channel. */
export interface TorStatus {
  state: 'idle' | 'starting' | 'connecting' | 'ready' | 'error' | 'stopping';
  progress: number;
  phase: string;
  error: { code: string; title: string; detail: string } | null;
  version: string;
  firstConnection: boolean;
  /** Seconds-long wait before Tor tries again by itself after a failure (0: not waiting). */
  retryInMs?: number;
  /** How many times a silent connection was restarted on another route (Tor stays on "connecting"). */
  slowRestarts?: number;
  /** Bridges in use for this connection (tor-bridges.cjs), or null when Tor connects directly. */
  bridges?: { type: TorBridgeKind | 'custom' | 'mixed' | 'vanilla' | string; count: number } | null;
  /** Tor looks blocked: no handshake with any relay or bridge yet, long after start. Tor keeps trying meanwhile. */
  blocked?: { phase: string; progress: number; offline: boolean; bridges: string | null } | null;
}
export type TorBridgeKind = 'obfs4' | 'snowflake' | 'meek';
type Reply = { tor?: TorStatus; identity?: { ok: boolean; delayed?: boolean; cleared?: boolean }; torBridges?: { ok?: boolean; mode: string; builtin: TorBridgeKind } };

/** One honest sentence pair, used everywhere Tor is offered (menu, page, chip). */
export const TOR_PROMISE = t('tor.promise');
/** What Acira's Tor protects, said plainly (founder 28 Oct: never send people to another browser; never claim more than this). */
export const TOR_PROTECTS = t('tor.protects');

/** A Tor window, or a Tor tab (privacy 'tor') in an ordinary window: the Tor chip and Tor page follow the active tab. */
export const isTorWindow = (state: BrowserSnapshot) => Boolean(state.browserProfiles.find(profile => profile.id === state.activeBrowserProfileId)?.tor) || state.tabs.find(tab => tab.id === state.activeTabId)?.privacy === 'tor';

/** A download from a Tor tab (any download, in a Tor window) that a New Tor identity would stop. Only this window's downloads are known here. */
export const torDownloadsActive = (state: BrowserSnapshot) => { const inTorWindow = Boolean(state.browserProfiles.find(profile => profile.id === state.activeBrowserProfileId)?.tor); return state.downloads.some(item => ['Downloading', 'Paused'].includes(item.status) && (inTorWindow || state.tabs.find(tab => tab.id === item.tabId)?.privacy === 'tor')); };

function call(type: 'tor.status' | 'tor.retry' | 'tor.new-identity' | 'tor.bridges-set', extra: Record<string, unknown> = {}): Promise<Reply> {
  const native = (runtime as unknown as { native?: (request: { type: string }) => Promise<Reply> }).native;
  if (!native) return Promise.reject(new Error('Tor needs the desktop app.'));
  return native({ type, ...extra });
}

// One subscription per window, shared by the chip and the page.
let current: TorStatus | null = null, subscribed = false;
const listeners = new Set<() => void>();
const publish = (next: TorStatus | undefined) => { if (!next) return; current = next; for (const listener of listeners) listener(); };
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!subscribed) {
    subscribed = true;
    // QA only: qa/n-tor-states.mjs dispatches fake statuses here to check every state's layout without waiting for Tor.
    window.addEventListener('acira-tor-preview', event => publish((event as CustomEvent<TorStatus>).detail));
    runtime.subscribeBrowser(event => { const e = event as unknown as { type: string; status?: TorStatus }; if (e.type === 'tor-status') publish(e.status); });
    void call('tor.status').then(reply => publish(reply.tor), () => undefined);
  }
  return () => { listeners.delete(listener); };
}
export function useTorStatus(): TorStatus | null { return useSyncExternalStore(subscribe, () => current, () => null); }

export const retryTor = () => call('tor.retry').then(reply => publish(reply.tor));
/** Tor Browser's order for a blocked network: obfs4 first, then Snowflake, then meek (the slowest, for the strictest networks). */
export const TOR_BRIDGE_ORDER: TorBridgeKind[] = ['obfs4', 'snowflake', 'meek'];
export const torBridgeName = (kind: string) => kind === 'snowflake' ? 'Snowflake' : kind === 'meek' ? 'meek' : kind === 'obfs4' ? 'obfs4' : kind === 'webtunnel' ? 'WebTunnel' : kind;
/** The bridge to offer next: the recommended one when none is in use, else the next kind in Tor Browser's order (null after meek or with the person's own bridges). */
export function nextTorBridge(status: TorStatus | null): TorBridgeKind | null {
  const using = status?.bridges?.type;
  if (!using) return 'obfs4';
  const index = TOR_BRIDGE_ORDER.indexOf(using as TorBridgeKind);
  return index >= 0 && index < TOR_BRIDGE_ORDER.length - 1 ? TOR_BRIDGE_ORDER[index + 1] : null;
}
/** Connect with a built-in bridge now (saved as the bridge setting; Tor reconnects with it at once). */
export const connectWithBridge = (kind: TorBridgeKind) => call('tor.bridges-set', { bridges: { mode: 'builtin', builtin: kind } }).then(reply => { if (reply.torBridges && reply.torBridges.ok === false) throw new Error(t('tor.blocked.bridgeFailed')); publish(reply.tor); });
export const newTorIdentity = () => call('tor.new-identity').then(reply => { publish(reply.tor); return reply.identity; });

/** Any other Tor request (tor-window.cjs handle): circuits, the security level, onion sites. */
export function torRequest<T>(request: { type: string } & Record<string, unknown>): Promise<T> {
  const native = (runtime as unknown as { native?: (request: { type: string }) => Promise<T> }).native;
  if (!native) return Promise.reject(new Error('Tor needs the desktop app.'));
  return native(request);
}
/** The reason a Tor request failed, without Electron's "Error invoking remote method" wrapper. */
export const torProblem = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('tor.vaultFailed');

/** One relay of a site's circuit (tor's control port; country from tor's geoip table, '' when unknown). */
export interface TorHop { role: 'guard' | 'middle' | 'exit' | 'rendezvous'; nickname: string; address: string; country: string }
export interface TorCircuit { site: string; onion: boolean; hops: TorHop[]; /** The site has not made a stream yet, so it has no circuit. */ pending: boolean }
/** The relays of the circuit the tab's site rides (Tor Browser's circuit display). */
export const readTorCircuit = (tabId?: string) => torRequest<{ circuit: TorCircuit }>({ type: 'tor.circuit', ...(tabId ? { tabId } : {}) }).then(reply => reply.circuit);

/** New Tor circuit for this site (Tor Browser's button): a fresh circuit for the tab's site, its page reloaded on it. Resolves to the site. */
export const newTorCircuit = (tabId?: string) => torRequest<{ circuit?: { site: string } }>({ type: 'tor.new-circuit', ...(tabId ? { tabId } : {}) }).then(reply => reply.circuit?.site || '');
/** The same, with the toast that says what happened (the rows in the menus and the site panel). */
export const runTorCircuit = (dispatch: (action: BrowserAction) => void, tabId?: string) => newTorCircuit(tabId).then(
  site => dispatch({ type: 'toast', text: t('tor.circuit.done', { site }) }),
  error => dispatch({ type: 'toast', text: torProblem(error), tone: 'error' }));
/** Its key: its own when the person gave it one, else the Seamless view key, which runs it in Tor (Tor Browser's Ctrl+Shift+L; main.cjs shortcut()). */
export const torCircuitShortcut = () => shortcutFor('tor-circuit') || shortcutFor('seamless-mode', 'Ctrl Shift L');
/** A Tor tab (or any tab of a Tor window) showing a website: what New Tor circuit for this site acts on. */
export const isTorSite = (state: BrowserSnapshot, tab?: { privacy?: string; contentKind: string; url: string }) => Boolean(tab && tab.contentKind === 'web' && /^https?:/i.test(tab.url) && (tab.privacy === 'tor' || state.browserProfiles.find(profile => profile.id === state.activeBrowserProfileId)?.tor));

/** Short state words for the chip and screen readers. */
const ERROR_CODES = ['missing', 'integrity', 'crashed', 'unreachable', 'clock', 'timeout', 'transports'];
/** Error title and detail in the current language, from the engine's error code (the engine's own English text is for logs and tests). */
export function torError(error: TorStatus['error']) {
  if (!error) return { title: t('tor.pop.errorFallback'), detail: '' };
  if (!ERROR_CODES.includes(error.code)) return { title: error.title || t('tor.pop.errorFallback'), detail: error.detail || '' };
  const dev = error.code === 'missing' && /fetch-tor/.test(error.detail);
  const text = {
    missing: { title: t('tor.err.missing.title'), detail: t(dev ? 'tor.err.missingDev.detail' : 'tor.err.missing.detail') },
    integrity: { title: t('tor.err.integrity.title'), detail: t('tor.err.integrity.detail') },
    crashed: { title: t('tor.err.crashed.title'), detail: t('tor.err.crashed.detail') },
    unreachable: { title: t('tor.err.unreachable.title'), detail: t('tor.err.unreachable.detail') },
    clock: { title: t('tor.err.clock.title'), detail: t('tor.err.clock.detail') },
    timeout: { title: t('tor.err.timeout.title'), detail: t('tor.err.timeout.detail') },
    transports: { title: t('tor.err.transports.title'), detail: t('tor.err.transports.detail') },
  } as Record<string, { title: string; detail: string }>;
  return text[error.code];
}
/** The bootstrap phase in words (tor's own names are jargon), from real progress. */
export function torPhase(status: TorStatus | null) {
  if (!status || status.state === 'idle' || status.state === 'starting') return t('tor.phase.starting');
  if (status.state === 'ready') return t('tor.phase.connected');
  const p = status.progress || 0;
  return p < 30 ? t('tor.phase.network') : p < 75 ? t('tor.phase.directory') : t('tor.phase.circuit');
}
export function torLabel(status: TorStatus | null) {
  if (!status || status.state === 'idle' || status.state === 'starting') return t('tor.phase.starting');
  if (status.state === 'ready') return t('tor.label.connected');
  if (status.state === 'error') return torError(status.error).title;
  return t('tor.label.connecting', { progress: status.progress });
}
