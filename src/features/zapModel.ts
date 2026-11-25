import { t, type MessageId } from '../i18n';
import type { BrowserEvent, ServiceRequest, ServiceResult, ZapKind, ZapRule, ZapSiteStatus } from '../runtime/types';

/**
 * Zap, the parts a person sees (Beta 14): no React and no runtime import, so the site controls (ZapSiteSection) and Settings > Privacy
 * (settings/panels/zap.tsx) draw one model and Node tests can run it with a stand-in for the service.
 *
 * A store reads once when something starts listening, again on every `filters-changed` (main says it after any change, from either
 * surface or the picker itself), and answers an action with the list main sends back, so a restore shows at once.
 */
export type ZapService = (request: ServiceRequest) => Promise<ServiceResult>;
export type ZapEvents = (listener: (event: BrowserEvent) => void) => () => void;
export type ZapSite = { host: string; rules: ZapRule[] };

const kindIds: Record<ZapKind, MessageId> = {
  frame: 'zap.kind.frame', video: 'zap.kind.video', image: 'zap.kind.image', bar: 'zap.kind.bar', popup: 'zap.kind.popup', widget: 'zap.kind.widget', block: 'zap.kind.block',
};
/** A kind's name; a kind a later version adds reads as "Part of the page". */
export const kindName = (kind: string): string => t(kindIds[kind as ZapKind] ?? 'zap.kind.block');
/** The part's own words, else the name of its kind. */
export const ruleName = (rule: Pick<ZapRule, 'label' | 'kind'>): string => (typeof rule.label === 'string' && rule.label.trim()) || kindName(rule.kind);
/** The quiet note ("May come back") belongs to the rows whose rule a site can defeat: a loose rule, or one that hides a frame. */
export const mayReturn = (rule: Pick<ZapRule, 'hold'>): boolean => rule.hold === 'loose' || rule.hold === 'frame';

const sound = (rule: unknown): rule is ZapRule => !!rule && typeof rule === 'object' && typeof (rule as ZapRule).id === 'string' && typeof (rule as ZapRule).host === 'string';
const soundRules = (rules: unknown): ZapRule[] => (Array.isArray(rules) ? rules.filter(sound) : []);
/** One page's removed parts out of a service answer; undefined when the answer is not that. */
export const siteStatus = (result: ServiceResult | undefined): ZapSiteStatus | undefined => {
  const zap = result?.zap;
  return zap && 'rules' in zap ? { supported: zap.supported === true, host: String(zap.host ?? ''), picking: zap.picking === true, private: zap.private === true, rules: soundRules(zap.rules) } : undefined;
};
/** Every site's removed parts out of a service answer, oldest site first as main sorts them; undefined when the answer is not that. */
export const siteList = (result: ServiceResult | undefined): ZapSite[] | undefined => {
  const zap = result?.zap;
  return zap && 'sites' in zap && Array.isArray(zap.sites)
    ? zap.sites.filter((site) => site && typeof site.host === 'string').map((site) => ({ host: site.host, rules: soundRules(site.rules) })).filter((site) => site.rules.length > 0)
    : undefined;
};

const fold = (value: string) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Settings' search: by the site's name (all of that site's parts) or by a part's name (the label, or the kind's name when it has none). */
export function filterSites(sites: readonly ZapSite[], query: string): ZapSite[] {
  const wanted = fold(query.trim());
  if (!wanted) return [...sites];
  return sites.flatMap((site) => {
    const rules = fold(site.host).includes(wanted) ? site.rules : site.rules.filter((rule) => fold(ruleName(rule)).includes(wanted));
    return rules.length ? [{ host: site.host, rules }] : [];
  });
}
export const countRules = (sites: readonly ZapSite[]): number => sites.reduce((sum, site) => sum + site.rules.length, 0);

const reason = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : String(error));

/** What a surface draws: nothing until the first answer; `failed` when that answer never came (the surface then draws nothing, or its error line). */
export interface ZapView<T> { value: T | undefined; failed: boolean; busy: boolean; error: string }
export interface ZapStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ZapView<T>;
  refresh: () => Promise<void>;
  /** Run a change; the list main answers with replaces the view (no second read, no reload); an answer of any other shape is read again. */
  act: (call: () => Promise<T | undefined>) => Promise<void>;
}

export function createZapStore<T>(read: () => Promise<T | undefined>, events: ZapEvents): ZapStore<T> {
  let view: ZapView<T> = { value: undefined, failed: false, busy: false, error: '' };
  let version = 0, inflight = 0, stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (next: Partial<ZapView<T>>) => { view = { ...view, ...next }; for (const listener of [...listeners]) listener(); };
  const refresh = async () => {
    const mine = ++version;
    try {
      const value = await read();
      if (mine !== version) return;
      if (value === undefined) set({ failed: view.value === undefined });
      else set({ value, failed: false });
    } catch (failure) { if (mine === version) set({ failed: view.value === undefined, error: reason(failure) }); }
  };
  const act = async (call: () => Promise<T | undefined>) => {
    const mine = ++version;
    inflight++;
    set({ busy: true, error: '' });
    let value: T | undefined, problem: { error: unknown } | undefined;
    try { value = await call(); } catch (error) { problem = { error }; }
    inflight--;
    const busy = inflight > 0;
    if (mine !== version) { set({ busy }); return; }
    if (problem) { set({ busy, error: reason(problem.error) }); void refresh(); return; }
    if (value === undefined) { set({ busy }); void refresh(); return; }
    set({ value, failed: false, busy, error: '' });
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      stop = events((event) => { if (event.type === 'filters-changed') void refresh(); });
      void refresh();
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) { stop?.(); stop = undefined; version++; /* an answer on its way is dropped */ }
    };
  };
  return { subscribe, getSnapshot: () => view, refresh, act };
}

/** The page's own removed parts (the site controls). */
export function createSiteStore(service: ZapService, events: ZapEvents, tabId: string) {
  const store = createZapStore<ZapSiteStatus>(async () => siteStatus(await service({ type: 'zap.site', tabId })), events);
  return {
    ...store,
    restore: (rule: Pick<ZapRule, 'host' | 'id'>) => store.act(async () => siteStatus(await service({ type: 'zap.restore', tabId, host: rule.host, id: rule.id }))),
    restoreAll: () => store.act(async () => siteStatus(await service({ type: 'zap.restore-all', tabId }))),
  };
}

/** Every site's removed parts (Settings > Privacy). */
export function createListStore(service: ZapService, events: ZapEvents) {
  const store = createZapStore<ZapSite[]>(async () => siteList(await service({ type: 'zap.list' })), events);
  return {
    ...store,
    restoreRule: (rule: Pick<ZapRule, 'host' | 'id'>) => store.act(async () => siteList(await service({ type: 'zap.restore-rule', host: rule.host, id: rule.id }))),
    restoreSite: (host: string) => store.act(async () => siteList(await service({ type: 'zap.restore-site', host }))),
    clear: () => store.act(async () => siteList(await service({ type: 'zap.clear' }))),
  };
}
